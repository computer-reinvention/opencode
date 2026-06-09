import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./trace.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  qname: Schema.String.annotate({
    description:
      "Fully-qualified symbol name to trace from: 'path/to/file:Name' or 'path/to/file:Class.method'. Drop the source extension; forward slashes on all OSes.",
  }),
  direction: Schema.optional(Schema.String).annotate({
    description: "Which way to traverse: 'callers' (default), 'callees', or 'both'.",
  }),
  depth: Schema.optional(Schema.Number).annotate({ description: "Max BFS depth. Defaults to 2. Clamped server-side." }),
})

export const TrieTraceTool = Tool.define(
  "trie_trace",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const flags = ["trace", args.qname]
          if (args.direction) flags.push("--direction", args.direction)
          if (args.depth !== undefined) flags.push("--depth", String(args.depth))
          const output = yield* trie.text(flags)
          return { title: args.qname, metadata: {}, output }
        }),
    }
  }),
)
