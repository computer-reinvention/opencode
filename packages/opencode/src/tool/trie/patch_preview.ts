import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./patch_preview.txt"
import { makeTrieRunner } from "./shared"

export const Parameters = Schema.Struct({})

export const TriePatchPreviewTool = Tool.define(
  "trie_patch_preview",
  Effect.gen(function* () {
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (_args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const output = yield* trie.text(["patch", "preview"], "(nothing to preview)")
          return { title: "preview", metadata: {}, output }
        }),
    }
  }),
)
