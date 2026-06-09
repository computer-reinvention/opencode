import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./find.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({
    description: "Glob pattern: '**/*.ts', 'Dockerfile', 'src/**/*.tsx', or a bare filename matched anywhere.",
  }),
  indexed_only: Schema.optional(Schema.Boolean).annotate({
    description: "Restrict to files in trie's scope. Default searches the whole tree.",
  }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Max paths to return. Defaults to 100." }),
})

export const TrieFindTool = Tool.define(
  "trie_find",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const flags = ["find", args.pattern]
          if (args.indexed_only) flags.push("--indexed-only")
          if (args.limit !== undefined) flags.push("--limit", String(args.limit))
          const output = yield* trie.text(flags, "(no files match)")
          return { title: args.pattern, metadata: {}, output }
        }),
    }
  }),
)
