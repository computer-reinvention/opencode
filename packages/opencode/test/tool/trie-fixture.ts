// Shared fixture for trie scenario tests: clone the synced /tmp/trie-trial
// project into a unique per-call temp dir so each test operates on isolated
// state (separate .trie/graph.db, triefacts/, source). This prevents the
// cross-file races that occur when multiple scenario test files mutate the
// single shared trial project in parallel.

import { cpSync, existsSync, mkdtempSync, rmSync } from "fs"
import os from "os"
import path from "path"

export const TRIAL = "/tmp/trie-trial"

// True when the canonical trial project is present + synced. Suites skip
// themselves when it isn't, so the repo's normal `bun test` (without the trial
// project) stays green.
export const trialReady = existsSync(`${TRIAL}/triefacts`) && existsSync(`${TRIAL}/.trie/graph.db`)

// Clone the synced trial project into a fresh temp dir and return its path.
// The caller is responsible for cleanup via `disposeClone`.
export function cloneTrial(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "trie-scn-"))
  // Copy source + the synced trie state. cpSync recursive mirrors the tree.
  for (const entry of ["calc", "trie.toml", "triefacts", ".trie"]) {
    const src = path.join(TRIAL, entry)
    if (existsSync(src)) cpSync(src, path.join(dir, entry), { recursive: true })
  }
  return dir
}

export function disposeClone(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
}
