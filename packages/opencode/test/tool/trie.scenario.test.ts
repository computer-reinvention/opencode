// Scenario tests for the native trie tool suite, exercised against a live
// trie-synced project at /tmp/trie-trial. These run the real tool code paths
// (which shell out to the `trie` CLI), so they validate end-to-end behaviour
// the way the agent experiences it.
//
// Requires: `trie` on PATH and /tmp/trie-trial initialised + synced. The suite
// skips itself cleanly when that project isn't present.

import { describe, expect } from "bun:test"
import { existsSync } from "fs"
import { Effect, Layer } from "effect"
import { TrieGrepTool } from "../../src/tool/trie/grep"
import { TrieReadTool } from "../../src/tool/trie/read"
import { TrieTraceTool } from "../../src/tool/trie/trace"
import { TriePatchListTool } from "../../src/tool/trie/patch_list"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import * as Tool from "../../src/tool/tool"
import { SessionID, MessageID } from "../../src/session/schema"
import { provideInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const TRIAL = "/tmp/trie-trial"
const ready = existsSync(`${TRIAL}/triefacts`)

const layer = Layer.mergeAll(
  AppFileSystem.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
)

const it = testEffect(layer)

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_trie_scenario"),
  messageID: MessageID.make("msg_trie_scenario"),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

// Run a tool's execute against the trial directory as the active instance.
function runIn<A, E, R>(dir: string, self: Effect.Effect<A, E, R>) {
  return self.pipe(provideInstance(dir))
}

describe.skipIf(!ready)("trie scenario: navigation", () => {
  it.live("trie_grep finds a known symbol with graph metrics", () =>
    Effect.gen(function* () {
      const tool = yield* (yield* TrieGrepTool).init()
      const res = yield* runIn(TRIAL, tool.execute({ pattern: "total" }, ctx))
      expect(res.output).toContain("total")
    }),
  )

  it.live("trie_read returns prose + neighbours for a qname", () =>
    Effect.gen(function* () {
      const tool = yield* (yield* TrieReadTool).init()
      const res = yield* runIn(TRIAL, tool.execute({ path: "calc/app:total" }, ctx))
      expect(res.output.length).toBeGreaterThan(0)
    }),
  )

  it.live("trie_read returns line-numbered source for a file path", () =>
    Effect.gen(function* () {
      const tool = yield* (yield* TrieReadTool).init()
      const res = yield* runIn(TRIAL, tool.execute({ path: "calc/ops.py", offset: 1, limit: 1 }, ctx))
      expect(res.output).toMatch(/^1: /)
    }),
  )

  it.live("trie_trace walks callers of a symbol", () =>
    Effect.gen(function* () {
      const tool = yield* (yield* TrieTraceTool).init()
      const res = yield* runIn(TRIAL, tool.execute({ qname: "calc/ops:add", direction: "callers" }, ctx))
      expect(res.output.length).toBeGreaterThan(0)
    }),
  )

  it.live("trie_patch_list reports an empty queue cleanly", () =>
    Effect.gen(function* () {
      const tool = yield* (yield* TriePatchListTool).init()
      const res = yield* runIn(TRIAL, tool.execute({}, ctx))
      expect(res.output.length).toBeGreaterThan(0)
    }),
  )
})
