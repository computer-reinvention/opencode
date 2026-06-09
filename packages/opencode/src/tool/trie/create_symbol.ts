import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./create_symbol.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  qname: Schema.String.annotate({ description: "Intended qualified name of the new symbol, e.g. 'pkg/mod:new_fn'." }),
  note: Schema.String.annotate({ description: "What the new symbol should do. trie generates the body from this." }),
  file: Schema.optional(Schema.String).annotate({ description: "Target source file (derived from qname when omitted)." }),
  anchor: Schema.optional(Schema.String).annotate({ description: "Place the new symbol after this existing qname." }),
})

export const TrieCreateSymbolTool = Tool.define(
  "trie_create_symbol",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const flags = ["patch", "create-symbol", args.qname, "--note", args.note]
          if (args.file) flags.push("--file", args.file)
          if (args.anchor) flags.push("--anchor", args.anchor)
          const r = yield* trie.run(flags, { TRIE_SESSION_ID: ctx.sessionID })
          if (r.code !== 0) throw new Error(`trie create-symbol failed (exit ${r.code}): ${r.stderr.trim() || "no stderr"}`)
          return { title: args.qname, metadata: {}, output: r.stdout.trim() || "create staged" }
        }),
    }
  }),
)
