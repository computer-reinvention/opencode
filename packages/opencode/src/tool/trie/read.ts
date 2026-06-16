import path from "path"
import { Schema, Effect } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "../tool"
import DESCRIPTION from "./read.txt"
import { makeTrieRunner, looksLikeQname } from "./shared"

const MAX_LINE_LENGTH = 2000

export const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description:
      "Either a qualified symbol name ('pkg/module:Name' or 'pkg/module:Class.method') OR a file path. Qnames route to trie's graph (prose + callers/callees). File paths return raw source.",
  }),
  show_source: Schema.optional(Schema.Boolean).annotate({
    description: "Force raw source mode for a file path. Use right before editing when you need exact bytes.",
  }),
  offset: Schema.optional(Schema.Number).annotate({
    description: "1-indexed first line to include (file-path reads only).",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Max number of lines to return from offset (file-path reads only).",
  }),
})

export const TrieReadTool = Tool.define(
  "trie_read",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const trie = yield* makeTrieRunner()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const forceSource = args.show_source === true || args.offset !== undefined || args.limit !== undefined
          if (!forceSource && looksLikeQname(args.path)) {
            const output = yield* trie.text(["read", args.path], "(symbol not found)")
            return { title: args.path, metadata: {}, output }
          }
          const ctx = yield* InstanceState.context
          const abs = path.isAbsolute(args.path) ? args.path : path.join(ctx.directory, args.path)
          const text = yield* fs.readFileString(abs).pipe(Effect.orDie)
          const all = text.split("\n")
          const start = args.offset !== undefined ? Math.max(0, args.offset - 1) : 0
          const end = args.limit !== undefined ? start + args.limit : all.length
          const numbered = all
            .slice(start, end)
            .map((line, i) => {
              const n = start + i + 1
              const clipped = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line
              return `${n}: ${clipped}`
            })
            .join("\n")
          return { title: args.path, metadata: {}, output: numbered || "(empty file)" }
        }),
    }
  }),
)
