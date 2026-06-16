import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./grep.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({
    description:
      "Substring to match against symbol local names (case-insensitive). If no symbol matches, trie falls back to ripgrep over indexed source bodies and attributes hits to enclosing symbols.",
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "Path prefix to restrict the search (e.g. 'src/' or 'trie/sync/'). Maps to scope_prefix.",
  }),
  kind: Schema.optional(Schema.String).annotate({
    description: "Restrict to one symbol kind: 'function', 'class', 'method', 'constant', 'module', or 'any'.",
  }),
  public_only: Schema.optional(Schema.Boolean).annotate({
    description: "If true, exclude symbols whose name starts with an underscore.",
  }),
  rank_by: Schema.optional(Schema.String).annotate({
    description: "Result ordering: 'public_first' (default), 'inbound_count' (centrality), or 'alphabetical'.",
  }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Max hits to return. Defaults to 10." }),
})

export const TrieGrepTool = Tool.define(
  "trie_grep",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const flags = ["grep", "--name", args.pattern]
          if (args.path) flags.push("--scope-prefix", args.path)
          if (args.kind) flags.push("--kind", args.kind)
          if (args.public_only) flags.push("--public-only")
          if (args.rank_by) flags.push("--rank-by", args.rank_by)
          if (args.limit !== undefined) flags.push("--limit", String(args.limit))
          const output = yield* trie.text(flags, "(no matches)")
          return { title: args.pattern, metadata: {}, output }
        }),
    }
  }),
)
