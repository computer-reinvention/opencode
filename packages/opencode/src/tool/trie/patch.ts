import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./patch.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  qname: Schema.String.annotate({ description: "Qualified name of the symbol to patch, e.g. 'src/foo:bar'." }),
  note: Schema.String.annotate({ description: "Implementation change note: what this symbol should now do." }),
  reason: Schema.optional(Schema.String).annotate({ description: "Optional: why the change is needed." }),
})

export const TriePatchTool = Tool.define(
  "trie_patch",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const flags = ["patch", "create", args.qname, "--note", args.note]
          if (args.reason) flags.push("--reason", args.reason)
          const r = yield* trie.run(flags, { TRIE_SESSION_ID: ctx.sessionID })
          if (r.code !== 0) throw new Error(`trie patch create failed (exit ${r.code}): ${r.stderr.trim() || "no stderr"}`)
          return { title: args.qname, metadata: {}, output: r.stdout.trim() || "patch posted" }
        }),
    }
  }),
)
