// Scenario tests for trie_read's dispatch (qname -> graph, path -> source,
// line-range windows) and error quality on bad inputs. Read-only against the
// shared synced trial project.

import { describe, expect } from "bun:test"
import { Effect, Layer, Exit, Cause } from "effect"
import { TrieReadTool } from "../../src/tool/trie/read"
import { TriePatchTool } from "../../src/tool/trie/patch"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import * as Tool from "../../src/tool/tool"
import { SessionID, MessageID } from "../../src/session/schema"
import { provideInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TRIAL, trialReady } from "./trie-fixture"

const ready = trialReady

const layer = Layer.mergeAll(
  AppFileSystem.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
)
const it = testEffect(layer)

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_trie_read"),
  messageID: MessageID.make("msg_trie_read"),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}
const runIn = <A, E, R>(e: Effect.Effect<A, E, R>) => e.pipe(provideInstance(TRIAL))

describe.skipIf(!ready)("trie scenario: read dispatch + errors", () => {
  it.live("qname arg returns symbol prose with callees", () =>
    Effect.gen(function* () {
      const tool = yield* (yield* TrieReadTool).init()
      const res = yield* runIn(tool.execute({ path: "calc/app:total" }, ctx))
      // Graph view mentions the callee add.
      expect(res.output.toLowerCase()).toContain("add")
    }),
  )

  it.live("file path arg returns line-numbered source", () =>
    Effect.gen(function* () {
      const tool = yield* (yield* TrieReadTool).init()
      const res = yield* runIn(tool.execute({ path: "calc/ops.py" }, ctx))
      expect(res.output).toMatch(/^1: /)
      expect(res.output).toContain("def add")
    }),
  )

  it.live("offset/limit window returns exactly the requested lines, numbered", () =>
    Effect.gen(function* () {
      const tool = yield* (yield* TrieReadTool).init()
      const res = yield* runIn(tool.execute({ path: "calc/ops.py", offset: 1, limit: 2 }, ctx))
      const lines = res.output.split("\n")
      expect(lines.length).toBe(2)
      expect(lines[0]).toMatch(/^1: /)
      expect(lines[1]).toMatch(/^2: /)
    }),
  )

  it.live("unknown qname surfaces a clear not-found (not a crash)", () =>
    Effect.gen(function* () {
      const tool = yield* (yield* TrieReadTool).init()
      // looksLikeQname true (has colon, has slash) but no such symbol.
      const res = yield* runIn(tool.execute({ path: "calc/ops:nonexistent_fn" }, ctx))
      // The CLI emits a structured not_found envelope on exit 1; the tool
      // surfaces it as output rather than throwing.
      expect(res.output.toLowerCase()).toMatch(/not.?found|no symbol|nonexistent/)
    }),
  )

  it.live("patch on a non-existent symbol fails with a legible error", () =>
    Effect.gen(function* () {
      const tool = yield* (yield* TriePatchTool).init()
      const exit = yield* runIn(
        tool.execute({ qname: "calc/ops:does_not_exist", note: "x" }, ctx),
      ).pipe(Effect.exit)
      // Either a structured failure or a captured error message — must be
      // concise and mention the failure, not a raw multi-line traceback.
      if (Exit.isFailure(exit)) {
        const msg = String(Cause.squash(exit.cause))
        expect(msg.toLowerCase()).toContain("patch")
        // The error must carry trie's actual message (on stdout), not "no stderr".
        expect(msg.toLowerCase()).toContain("not found")
        expect(msg).not.toContain("no stderr")
        expect(msg.split("\n").length).toBeLessThan(6)
      } else {
        // Some trie versions stage optimistically; tolerate that but require output.
        expect((exit.value as { output: string }).output.length).toBeGreaterThan(0)
      }
    }),
  )
})
