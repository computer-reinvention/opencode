import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./explain_symbol_refs.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  sym: Schema.String.annotate({ description: "Symbol qname or name fragment. Returns the usage story (callers prose only)." }),
})

export const TrieExplainSymbolRefsTool = Tool.define(
  "explain_symbol_refs",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const output = yield* trie.text(["explain-symbol-refs", args.sym], "(no callers)")
          return { title: args.sym, metadata: {}, output }
        }),
    }
  }),
)
