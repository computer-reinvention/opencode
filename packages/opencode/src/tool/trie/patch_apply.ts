import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./patch_apply.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  note: Schema.String.annotate({
    description: "Session note: the single unifying intent behind all pending patches. Required.",
  }),
  backend: Schema.optional(Schema.String).annotate({ description: "Edit backend override ('llm' default)." }),
  commit_mode: Schema.optional(Schema.String).annotate({
    description: "all_or_nothing (default) | per_item | per_group.",
  }),
})

export const TriePatchApplyTool = Tool.define(
  "trie_patch_apply",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const flags = ["patch", "apply", "--note", args.note]
          if (args.backend) flags.push("--backend", args.backend)
          if (args.commit_mode) flags.push("--commit-mode", args.commit_mode)
          const r = yield* trie.run(flags, { TRIE_SESSION_ID: ctx.sessionID })
          if (r.code === 0) return { title: "apply", metadata: {}, output: r.stdout.trim() || "patches applied" }
          // Exit 1 with structured output on stdout = a real ApplyReport with
          // blocking unresolved items; surface it so the agent can act.
          const out = r.stdout.trim()
          if (r.code === 1 && out) return { title: "apply (unresolved)", metadata: {}, output: out }
          // Otherwise it crashed (e.g. missing API key, internal error). The
          // traceback lands on stderr; don't dump it at the agent — extract the
          // last meaningful line so the failure is legible and actionable.
          throw new Error(`trie patch apply failed (exit ${r.code}): ${summarizeError(r.stderr)}`)
        }),
    }
  }),
)

// Pull a concise, agent-facing message out of a Python traceback dump. We want
// the final exception line (e.g. "UserError: Set the ANTHROPIC_API_KEY ...")
// rather than 100 lines of stack frames. Falls back to a trimmed tail.
function summarizeError(stderr: string): string {
  const text = stderr.trim()
  if (!text) return "no stderr"
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^[│╭╰┃╮╯]\s?|\s?[│┃]$/g, "").trim())
    .filter((l) => l && !/^[─╌-]+$/.test(l))
  // Find the exception line ("SomeError: message") and join any wrapped
  // continuation lines (rich word-wraps long messages across the box width).
  const idx = lines.findLastIndex((l) => /^[A-Za-z_][\w.]*(Error|Exception):/.test(l))
  if (idx !== -1) return lines.slice(idx).join(" ").replace(/\s+/g, " ").slice(0, 400)
  return (lines[lines.length - 1] ?? text).slice(0, 400)
}
