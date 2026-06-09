import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./grep_str.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  regexp: Schema.String.annotate({ description: "Regex pattern to search source bodies with (ripgrep syntax). Attributes each matched line to its enclosing symbol." }),
})

export const TrieGrepStrTool = Tool.define(
  "grep_str",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const output = yield* trie.text(["grep-str", args.regexp], "(no matches)")
          return { title: args.regexp, metadata: {}, output }
        }),
    }
  }),
)
