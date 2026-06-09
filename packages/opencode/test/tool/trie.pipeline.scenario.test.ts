// Scenario for the patch pipeline as the agent drives it:
// trie_patch (stage intent) -> trie_patch_preview (inspect blast radius) ->
// trie_patch_apply.
//
// NOTE: bun's test runner scrubs provider API keys from the process env, so
// the LLM-backed apply step cannot complete here — the full apply (generate +
// cascade + commit) is validated via the `trie` CLI directly. This test
// validates the agent-facing tool chain: staging works, preview reflects it,
// and a failed apply surfaces a CONCISE error (not a raw Python traceback),
// which is the behaviour we fixed. Opt-in via TRIE_PIPELINE_E2E=1.

import { describe, expect } from "bun:test"
import { existsSync } from "fs"
import { Effect, Layer, Exit, Cause } from "effect"
import { TriePatchTool } from "../../src/tool/trie/patch"
import { TriePatchPreviewTool } from "../../src/tool/trie/patch_preview"
import { TriePatchApplyTool } from "../../src/tool/trie/patch_apply"
import { TriePatchDropTool } from "../../src/tool/trie/patch_drop"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import * as Tool from "../../src/tool/tool"
import { SessionID, MessageID } from "../../src/session/schema"
import { provideInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const TRIAL = "/tmp/trie-trial"
const enabled = process.env.TRIE_PIPELINE_E2E === "1" && existsSync(`${TRIAL}/triefacts`)

const layer = Layer.mergeAll(
  AppFileSystem.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
)
const it = testEffect(layer)

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_trie_pipeline"),
  messageID: MessageID.make("msg_trie_pipeline"),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

function runIn<A, E, R>(self: Effect.Effect<A, E, R>) {
  return self.pipe(provideInstance(TRIAL))
}

describe.skipIf(!enabled)("trie scenario: patch pipeline (e2e)", () => {
  it.live(
    "patch stages, preview reflects it, and a keyless apply fails concisely",
    () =>
      Effect.gen(function* () {
        const patch = yield* (yield* TriePatchTool).init()
        const preview = yield* (yield* TriePatchPreviewTool).init()
        const apply = yield* (yield* TriePatchApplyTool).init()
        const drop = yield* (yield* TriePatchDropTool).init()

        // Clean any leftover queue from a prior run.
        yield* runIn(drop.execute({ all: true }, ctx))

        // 1) Stage intent against a symbol.
        const staged = yield* runIn(
          patch.execute(
            { qname: "calc/ops:add", note: "Clamp the result to be non-negative: return max(0, a + b)." },
            ctx,
          ),
        )
        expect(staged.output.length).toBeGreaterThan(0)

        // 2) Preview shows the patched symbol.
        const previewed = yield* runIn(preview.execute({}, ctx))
        expect(previewed.output).toContain("add")

        // 3) Apply has no API key under bun test → must fail with a CONCISE,
        // actionable message, NOT a raw multi-line Python traceback.
        const exit = yield* runIn(apply.execute({ note: "make add saturating" }, ctx)).pipe(Effect.exit)
        const msg = Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : "(unexpected success)"
        expect(msg).toContain("trie patch apply failed")
        // Concise: not a 100-line traceback. (one or two lines max)
        expect(msg.split("\n").length).toBeLessThan(5)

        // Cleanup the staged patch so the trial repo is left clean.
        yield* runIn(drop.execute({ all: true }, ctx))
      }),
    120_000,
  )
})
