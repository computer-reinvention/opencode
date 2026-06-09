import { Effect } from "effect"
import type { Config } from "@/config/config"

// Shared trie edit guard used by the backup edit/write tools.
//
// Returns a model-facing error message string when the operation must be
// refused (the file is trie-indexed code and the agent should use the patch
// pipeline), or null when it's allowed. The guard is bypassed by `force` and
// by the `experimental.trie_edit_guard: false` kill-switch. It defaults ON.

interface Probes {
  synced: (filePath: string) => Effect.Effect<boolean>
}

export const trieGuardError = Effect.fn("trie.guard")(function* (
  config: Config.Interface,
  probes: Probes,
  filePath: string,
  force: boolean,
  op: "edit" | "write",
) {
  if (force) return null
  const cfg = yield* config.get()
  // Default ON: only disabled when explicitly set to false.
  if (cfg.experimental?.trie_edit_guard === false) return null
  const synced = yield* probes.synced(filePath)
  if (!synced) return null
  return [
    `Refused: ${filePath} is a trie-indexed code file.`,
    op === "edit"
      ? "Edit indexed code through the trie patch pipeline instead of hand-editing:"
      : "Modify indexed code through the trie patch pipeline instead of overwriting:",
    "  - trie_patch(qname, note) to change a function/method/class body,",
    "  - trie_create_symbol / trie_delete_symbol / trie_rename_symbol for structural changes,",
    "  - then trie_patch_preview and trie_patch_apply(note).",
    "If this is a sub-symbol edit (one line), a non-symbol region (module constants, file header),",
    "or the patch pipeline cannot express the change, re-call with force=true.",
  ].join("\n")
})
