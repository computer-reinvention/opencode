import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./blast_radius.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  qname: Schema.String.annotate({ description: "Symbol whose edit blast radius to compute." }),
})

export const TrieBlastRadiusTool = Tool.define(
  "trie_blast_radius",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const output = yield* trie.text(["blast-radius", args.qname], "(no blast radius)")
          return { title: args.qname, metadata: {}, output }
        }),
    }
  }),
)
