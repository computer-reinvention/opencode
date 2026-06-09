// Scenario: the experimental.trie_edit_guard kill-switch. When set false in the
// project's opencode.json, fs_edit must be ALLOWED to modify indexed code
// without refusal. The test writes the config before and removes it after, so
// the trial repo has no opencode.json at rest (keeping the default-on guard
// scenario test independent).

import { describe, expect } from "bun:test"
import { readFileSync, writeFileSync } from "fs"
import path from "path"
import { Effect, Layer } from "effect"
import { EditTool } from "../../src/tool/edit"
import { LSP } from "@/lsp/lsp"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Format } from "../../src/format"
import { Bus } from "../../src/bus"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { Config } from "@/config/config"
import * as Tool from "../../src/tool/tool"
import { SessionID, MessageID } from "../../src/session/schema"
import { provideInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { cloneTrial, disposeClone, trialReady } from "./trie-fixture"

const ready = trialReady

const layer = Layer.mergeAll(
  LSP.defaultLayer,
  AppFileSystem.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Format.defaultLayer,
  Bus.layer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
  Config.defaultLayer,
)
const it = testEffect(layer)

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_trie_killswitch"),
  messageID: MessageID.make("msg_trie_killswitch"),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe.skipIf(!ready)("trie scenario: edit-guard kill-switch", () => {
  it.live("fs_edit is ALLOWED on indexed code when trie_edit_guard=false", () =>
    Effect.gen(function* () {
      const dir = cloneTrial()
      try {
        writeFileSync(
          path.join(dir, "opencode.json"),
          JSON.stringify({ $schema: "https://opencode.ai/config.json", experimental: { trie_edit_guard: false } }),
        )
        const opsPath = path.join(dir, "calc/ops.py")
        void readFileSync(opsPath, "utf8")
        const tool = yield* (yield* EditTool).init()
        const res = yield* tool
          .execute({ filePath: opsPath, oldString: "a + b", newString: "a + b  # ks" }, ctx)
          .pipe(provideInstance(dir))
        expect(res.output).toContain("Edit applied")
      } finally {
        disposeClone(dir)
      }
    }),
  )
})
