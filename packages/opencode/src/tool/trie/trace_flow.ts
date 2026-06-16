import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./trace_flow.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  symbol1: Schema.String.annotate({ description: "Starting symbol — qname or name fragment." }),
  symbol2: Schema.String.annotate({ description: "Target symbol — qname or name fragment." }),
})

export const TrieTraceFlowTool = Tool.define(
  "trie_trace_flow",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const output = yield* trie.text(["trace-flow", args.symbol1, args.symbol2], "(no path found)")
          return { title: `${args.symbol1} -> ${args.symbol2}`, metadata: {}, output }
        }),
    }
  }),
)
