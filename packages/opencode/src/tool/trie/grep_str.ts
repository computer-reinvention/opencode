import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./grep_str.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  regexp: Schema.String.annotate({
    description:
      "Regex pattern to search source bodies with (ripgrep syntax). Attributes each matched line to its enclosing symbol.",
  }),
  all_files: Schema.optional(Schema.Boolean).annotate({
    description:
      "Search the WHOLE repo including non-indexed files (TS/JS, configs, docs, lockfiles), not just indexed source bodies. In-scope hits are still attributed to symbols; out-of-scope hits return file:line:text.",
  }),
})

export const TrieGrepStrTool = Tool.define(
  "trie_grep_str",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const flags = ["grep-str", args.regexp]
          if (args.all_files) flags.push("--all-files")
          const output = yield* trie.text(flags, "(no matches)")
          return { title: args.regexp, metadata: {}, output }
        }),
    }
  }),
)
