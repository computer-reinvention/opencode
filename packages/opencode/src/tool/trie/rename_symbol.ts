import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./rename_symbol.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({
  qname: Schema.String.annotate({ description: "Qualified name of the symbol to rename." }),
  new_name: Schema.String.annotate({ description: "New LOCAL name (not a qualified name)." }),
})

export const TrieRenameSymbolTool = Tool.define(
  "trie_rename_symbol",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const r = yield* trie.run(["patch", "rename-symbol", args.qname, args.new_name], { TRIE_SESSION_ID: ctx.sessionID })
          if (r.code !== 0) throw new Error(`trie rename-symbol failed (exit ${r.code}): ${r.stderr.trim() || "no stderr"}`)
          return { title: `${args.qname} -> ${args.new_name}`, metadata: {}, output: r.stdout.trim() || "rename staged" }
        }),
    }
  }),
)
