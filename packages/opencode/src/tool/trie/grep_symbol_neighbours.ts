import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./grep_symbol_neighbours.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  sym: Schema.String.annotate({ description: "Symbol name or fragment to fuzzy-match. Returns the match plus its immediate callers and callees in one round trip." }),
})

export const TrieGrepSymbolNeighboursTool = Tool.define(
  "trie_grep_symbol_neighbours",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const output = yield* trie.text(["grep-symbol-neighbours", args.sym], "(no match)")
          return { title: args.sym, metadata: {}, output }
        }),
    }
  }),
)
