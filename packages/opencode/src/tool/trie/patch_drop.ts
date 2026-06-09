import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./patch_drop.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  qname: Schema.optional(Schema.String).annotate({ description: "Drop patches for a specific symbol." }),
  all: Schema.optional(Schema.Boolean).annotate({ description: "Drop all pending patches." }),
})

export const TriePatchDropTool = Tool.define(
  "trie_patch_drop",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const flags = ["patch", "drop"]
          if (args.all) flags.push("--all")
          else if (args.qname) flags.push("--qname", args.qname)
          else flags.push("--session", ctx.sessionID)
          const r = yield* trie.run(flags, { TRIE_SESSION_ID: ctx.sessionID })
          if (r.code !== 0) throw new Error(`trie patch drop failed (exit ${r.code}): ${r.stderr.trim() || "no stderr"}`)
          return { title: "drop", metadata: {}, output: r.stdout.trim() || "patches dropped" }
        }),
    }
  }),
)
