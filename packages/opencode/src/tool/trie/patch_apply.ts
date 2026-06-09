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
          // Exit 1 carries the ApplyReport with blocking unresolved items — surface it, don't throw.
          if (r.code === 0) return { title: "apply", metadata: {}, output: r.stdout.trim() || "patches applied" }
          if (r.code === 1) return { title: "apply (unresolved)", metadata: {}, output: r.stdout.trim() || r.stderr.trim() }
          throw new Error(`trie patch apply failed (exit ${r.code}): ${r.stderr.trim() || "no stderr"}`)
        }),
    }
  }),
)
