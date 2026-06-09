// Scenario tests for the trie edit guard, against the live /tmp/trie-trial
// project. Validates that the backup edit/write tools refuse to touch
// trie-indexed code files and steer the agent to the patch pipeline, while
// still allowing non-indexed files, new files, and force overrides.

import { describe, expect } from "bun:test"
import { existsSync } from "fs"
import { Effect, Layer, Exit, Cause } from "effect"
import { EditTool } from "../../src/tool/edit"
import { WriteTool } from "../../src/tool/write"
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

const TRIAL = "/tmp/trie-trial"
const ready = existsSync(`${TRIAL}/triefacts`)

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
  sessionID: SessionID.make("ses_trie_guard"),
  messageID: MessageID.make("msg_trie_guard"),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

function runIn<A, E, R>(self: Effect.Effect<A, E, R>) {
  return self.pipe(provideInstance(TRIAL))
}

describe.skipIf(!ready)("trie scenario: edit guard", () => {
  it.live("fs_edit is REFUSED on an indexed .py file and points to the patch flow", () =>
    Effect.gen(function* () {
      const tool = yield* (yield* EditTool).init()
      const exit = yield* runIn(
        tool.execute(
          { filePath: `${TRIAL}/calc/ops.py`, oldString: "a + b", newString: "a + b + 0" },
          ctx,
        ),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      const msg = Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : ""
      expect(msg).toContain("trie-indexed")
      expect(msg).toContain("trie_patch")
    }),
  )

  it.live("fs_edit with force=true bypasses the guard on an indexed file", () =>
    Effect.gen(function* () {
      const tool = yield* (yield* EditTool).init()
      // add then immediately revert via two forced edits to leave the file pristine.
      yield* runIn(
        tool.execute(
          { filePath: `${TRIAL}/calc/ops.py`, oldString: "a - b", newString: "a - b  # nudge", force: true },
          ctx,
        ),
      )
      const res = yield* runIn(
        tool.execute(
          { filePath: `${TRIAL}/calc/ops.py`, oldString: "a - b  # nudge", newString: "a - b", force: true },
          ctx,
        ),
      )
      expect(res.output).toContain("Edit applied")
    }),
  )

  it.live("fs_edit is ALLOWED on a non-indexed file (README.md)", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const p = `${TRIAL}/README.md`
      yield* runIn(Effect.promise(() => Bun.write(p, "# trial\n\nhello\n")))
      const tool = yield* (yield* EditTool).init()
      const res = yield* runIn(tool.execute({ filePath: p, oldString: "hello", newString: "world" }, ctx))
      expect(res.output).toContain("Edit applied")
      yield* runIn(Effect.promise(() => Bun.write(p, "# trial\n")))
      yield* fs.existsSafe(p) // touch service so it's used
    }),
  )

  it.live("fs_write is ALLOWED for creating a NEW file", () =>
    Effect.gen(function* () {
      const tool = yield* (yield* WriteTool).init()
      const p = `${TRIAL}/notes.txt`
      const res = yield* runIn(tool.execute({ filePath: p, content: "scratch\n" }, ctx))
      expect(res.output).toContain("Wrote file")
      yield* runIn(Effect.promise(() => Bun.file(p).unlink()))
    }),
  )
})
