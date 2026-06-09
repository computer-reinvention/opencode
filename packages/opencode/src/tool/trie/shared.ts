import path from "path"
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"

// Shared infrastructure for the native trie tool suite.
//
// Every `trie_*` tool shells out to the `trie` CLI (assumed on PATH) rather
// than re-implementing trie's graph logic in TS. The CLI is the single source
// of truth: its `--json` output is byte-equivalent to trie's MCP wire format,
// and it walks up from cwd to find `trie.toml` exactly like the MCP server.
//
// Tool `execute` closures must have Effect requirements `never` (the registry
// resolves nothing for them) and may not surface typed errors. So a tool
// resolves the spawner ONCE at init via `makeTrieRunner()` and closes over the
// returned helpers, each of which fully handles its own services + failures.

export interface TrieResult {
  stdout: string
  stderr: string
  code: number | null
}

export interface TrieRunner {
  // Spawn `trie <flags>` in the session cwd; collect stdout/stderr/exit code.
  run: (flags: string[], extraEnv?: Record<string, string>) => Effect.Effect<TrieResult>
  // Run trie and return stdout for codes 0/1 (success / structured-error
  // envelope), throwing only on usage errors (>=2). Convenience for the many
  // read-only navigation tools.
  text: (flags: string[], empty?: string) => Effect.Effect<string>
}

// Resolve the spawner at tool-init time and return closures with no leftover
// Effect requirements. Call this inside a tool's `Tool.define(... Effect.gen)`.
export const makeTrieRunner = Effect.fn("trie.makeTrieRunner")(function* () {
  const spawner = yield* ChildProcessSpawner

  const run = (flags: string[], extraEnv?: Record<string, string>): Effect.Effect<TrieResult> =>
    Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make("trie", flags, {
              cwd: ctx.directory,
              env: extraEnv ?? {},
              extendEnv: true,
              stdin: "ignore",
            }),
          )
          let stdout = ""
          let stderr = ""
          yield* Effect.all(
            [
              Stream.runForEach(Stream.decodeText(handle.stdout), (c) =>
                Effect.sync(() => {
                  stdout += c
                }),
              ),
              Stream.runForEach(Stream.decodeText(handle.stderr), (c) =>
                Effect.sync(() => {
                  stderr += c
                }),
              ),
            ],
            { concurrency: "unbounded" },
          )
          const code = yield* handle.exitCode
          return { stdout, stderr, code } satisfies TrieResult
        }),
      )
    }).pipe(
      // A missing `trie` binary (ENOENT) or any spawn defect becomes a useful
      // result the agent can act on, rather than crashing the turn.
      Effect.catchCause((cause) =>
        Effect.succeed({
          stdout: "",
          stderr: `failed to run 'trie' (is it on PATH?): ${cause}`,
          code: 127,
        } satisfies TrieResult),
      ),
    )

  const text = (flags: string[], empty = "(empty response from trie)"): Effect.Effect<string> =>
    run(flags).pipe(
      Effect.map((r) => {
        if (r.code === 0 || r.code === 1) return r.stdout.trim() || empty
        throw new Error(`trie ${flags[0]} failed (exit ${r.code}): ${r.stderr.trim() || "no stderr"}`)
      }),
      Effect.orDie,
    )

  return { run, text } satisfies TrieRunner
})

// Resolve the filesystem at init time and return sync/availability probes.
// Intentionally depends ONLY on the filesystem (not the spawner) so the
// backup edit/write tools that use it for the guard don't acquire a
// ChildProcessSpawner requirement. `available` infers from trie.toml +
// triefacts/ on disk rather than spawning `trie --help`.
export const makeTrieProbes = Effect.fn("trie.makeTrieProbes")(function* () {
  const fs = yield* AppFileSystem.Service

  // Resolve symlinks so comparisons are stable. On macOS the instance dir is
  // realpath'd to /private/tmp/... while an agent-supplied path may still be
  // /tmp/...; without this the prefix check below silently fails and the guard
  // never fires. `AppFileSystem.resolve` runs realpathSync on every platform
  // (normalizePath is a no-op off Windows) with an ENOENT fallback, so it's
  // safe for both existing and not-yet-created paths.
  const real = (p: string): string => AppFileSystem.resolve(p)

  const projectRoot = (dir: string): Effect.Effect<string | null> =>
    Effect.gen(function* () {
      let cur = real(dir)
      for (;;) {
        const exists = yield* fs.exists(path.join(cur, "trie.toml")).pipe(Effect.orElseSucceed(() => false))
        if (exists) return cur
        const parent = path.dirname(cur)
        if (parent === cur) return null
        cur = parent
      }
    })

  // trie.toml is reachable from cwd (the project is trie-configured). We don't
  // spawn the binary here to keep this probe spawner-free; tools that actually
  // run trie surface a clear error if the binary is missing.
  const available = (): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const root = yield* projectRoot(ctx.directory)
      return root !== null
    })

  // A file is trie-indexed iff `<root>/triefacts/<rel-with-.md>` exists.
  const synced = (filePath: string): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const raw = path.isAbsolute(filePath) ? path.normalize(filePath) : path.join(ctx.directory, filePath)
      // Realpath the parent dir (which exists even when the file is new) and
      // rejoin the basename, so symlinked prefixes line up with `root`.
      const abs = path.join(real(path.dirname(raw)), path.basename(raw))
      const root = yield* projectRoot(ctx.directory)
      if (root === null) return false
      const prefix = root.endsWith(path.sep) ? root : root + path.sep
      if (!abs.startsWith(prefix)) return false
      const rel = abs.slice(prefix.length)
      const dot = rel.lastIndexOf(".")
      const stem = dot > 0 ? rel.slice(0, dot) : rel
      const triefact = path.join(root, "triefacts", stem + ".md")
      return yield* fs.exists(triefact).pipe(Effect.orElseSucceed(() => false))
    })

  return { available, synced }
})

// Pick the most useful failure text from a trie result. trie writes its
// structured `error: ...` line to stdout (not stderr), so on a non-zero exit
// the actionable message is usually on stdout; fall back to stderr only when
// stdout is empty (e.g. a hard crash whose traceback lands on stderr).
export function errText(r: TrieResult): string {
  return r.stdout.trim() || r.stderr.trim() || "no output"
}

// trie qnames look like `path/to/file:Name` or `path/to/file:Class.method`.
export function looksLikeQname(s: string): boolean {
  if (!s.includes(":")) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(s)) return false // URL scheme
  if (/^[A-Za-z]:[\\/]/.test(s)) return false // Windows drive
  return true
}
