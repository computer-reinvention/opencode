import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./patch_list.txt"
import { makeTrieRunner, errText } from "./shared"

export const Parameters = Schema.Struct({})

export const TriePatchListTool = Tool.define(
  "trie_patch_list",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (_args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const r = yield* trie.run(["patch", "list"])
          if (r.code !== 0) throw new Error(`trie patch list failed (exit ${r.code}): ${errText(r)}`)
          return { title: "pending patches", metadata: {}, output: r.stdout.trim() || "(no pending patches)" }
        }),
    }
  }),
)
