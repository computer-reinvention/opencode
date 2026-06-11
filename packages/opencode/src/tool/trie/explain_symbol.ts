import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./explain_symbol.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  sym: Schema.String.annotate({ description: "Symbol qname or name fragment. Returns full prose plus a narrative weaving in its callers and callees." }),
})

export const TrieExplainSymbolTool = Tool.define(
  "trie_explain_symbol",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const output = yield* trie.text(["explain-symbol", args.sym], "(no prose)")
          return { title: args.sym, metadata: {}, output }
        }),
    }
  }),
)
