import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./grep_symbol.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  sym: Schema.String.annotate({ description: "Symbol name or fragment to fuzzy-match (typo-tolerant). Returns best match plus similar alternatives." }),
})

export const TrieGrepSymbolTool = Tool.define(
  "grep_symbol",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const output = yield* trie.text(["grep-symbol", args.sym], "(no match)")
          return { title: args.sym, metadata: {}, output }
        }),
    }
  }),
)
