import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./grep_entry_points.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Topic or concept to match against symbol prose (e.g. authentication, error handling). Returns high-inbound public entry points." }),
})

export const TrieGrepEntryPointsTool = Tool.define(
  "trie_grep_entry_points",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const output = yield* trie.text(["grep-entry-points", args.query], "(no entry points found)")
          return { title: args.query, metadata: {}, output }
        }),
    }
  }),
)
