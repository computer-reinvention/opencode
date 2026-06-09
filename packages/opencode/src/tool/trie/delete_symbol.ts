import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./delete_symbol.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  qname: Schema.String.annotate({ description: "Qualified name of the symbol to delete, e.g. 'pkg/mod:old_fn'." }),
})

export const TrieDeleteSymbolTool = Tool.define(
  "trie_delete_symbol",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const r = yield* trie.run(["patch", "delete-symbol", args.qname], { TRIE_SESSION_ID: ctx.sessionID })
          if (r.code !== 0) throw new Error(`trie delete-symbol failed (exit ${r.code}): ${r.stderr.trim() || "no stderr"}`)
          return { title: args.qname, metadata: {}, output: r.stdout.trim() || "delete staged" }
        }),
    }
  }),
)
