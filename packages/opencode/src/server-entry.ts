/**
 * Minimal entrypoint for the trie desktop app.
 * Starts the opencode HTTP server on the requested port.
 * Usage: opencode-server --port <n> [--hostname <h>]
 */

import { Effect } from "effect"
import { AppRuntime } from "./effect/app-runtime"
import { Server } from "./server/server"

const args = process.argv.slice(2)

function flag(name: string, fallback: string): string {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] ? args[i + 1]! : fallback
}

const port = parseInt(flag("--port", "4096"), 10)
const hostname = flag("--hostname", "0.0.0.0")

AppRuntime.runPromise(
  Effect.gen(function* () {
    const server = yield* Effect.promise(() => Server.listen({ port, hostname, mdns: false }))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)
    yield* Effect.never
  })
).catch((err: unknown) => {
  console.error("opencode server error:", err)
  process.exit(1)
})
