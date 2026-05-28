import { Bus } from "@/bus"
import { MCP } from "@/mcp"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionStatus } from "@/session/status"
import { File } from "@/file"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Scope, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { DesktopApi } from "../groups/desktop"

const log = Log.create({ service: "desktop" })

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function desktopEvent(type: string, properties: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify({ id: Bus.createID(), type, properties }),
  }
}

// ---------------------------------------------------------------------------
// Bus event → desktop event mapping
//
// We subscribe to all bus events and map the ones the graph canvas cares
// about to typed desktop.* events. Everything else is dropped.
// ---------------------------------------------------------------------------

function mapBusEvent(event: { type: string; properties: Record<string, unknown> }): Sse.Event | null {
  const { type, properties } = event

  // Tool state transitions — the core of graph animation.
  if (type === "message.part.updated") {
    const part = (properties as any).part
    if (!part || part.type !== "tool") return null

    const state = part.state
    if (!state) return null

    if (state.status === "running") {
      return desktopEvent("desktop.tool.start", {
        sessionID: part.sessionID,
        messageID: part.messageID,
        partID: part.id,
        callID: part.callID,
        tool: part.tool,
        input: state.input ?? {},
        time: state.time,
      })
    }

    if (state.status === "completed" || state.status === "error") {
      return desktopEvent("desktop.tool.done", {
        sessionID: part.sessionID,
        messageID: part.messageID,
        partID: part.id,
        callID: part.callID,
        tool: part.tool,
        input: state.input ?? {},
        output: state.status === "completed" ? state.output : null,
        error: state.status === "error" ? state.error : null,
        time: state.time,
      })
    }

    return null
  }

  // Streaming text deltas — feeds the response panel.
  if (type === "message.part.delta") {
    return desktopEvent("desktop.text.delta", {
      sessionID: properties.sessionID,
      messageID: properties.messageID,
      partID: properties.partID,
      delta: properties.delta,
    })
  }

  // Session status — drives input bar enable/disable.
  if (type === "session.status") {
    const status = (properties as any).status
    if (!status) return null
    return desktopEvent("desktop.session.status", {
      sessionID: properties.sessionID,
      status: {
        type: status.type ?? "idle",
        ...(status.error ? { error: status.error } : {}),
      },
    })
  }

  // File edits — marks graph nodes stale.
  if (type === "file.edited") {
    return desktopEvent("desktop.file.edited", {
      file: properties.file,
    })
  }

  return null
}

// ---------------------------------------------------------------------------
// MCP tool proxy helper
//
// The desktop graph endpoints proxy calls through to trie's MCP tools.
// We call mcp.tools() to get the live AI-SDK tool map, find the trie_*
// tool by name, and call its execute() method.
// ---------------------------------------------------------------------------

async function callTrieTool(
  tools: Record<string, { execute: (args: unknown) => Promise<unknown> }>,
  toolName: string,
  args: unknown,
): Promise<unknown> {
  // trie tools are registered with the MCP server name prefix.
  // The user configures the trie MCP server as "trie" in opencode.json,
  // so tools are named "trie_read", "trie_grep", etc.
  // Fall back to the bare name if no prefix match is found.
  const prefixed = `trie_${toolName}`
  const tool = tools[prefixed] ?? tools[toolName]
  if (!tool) {
    return { error: { code: "not_found", message: `trie MCP tool not found: ${prefixed}` } }
  }
  try {
    const result = await tool.execute(args ?? {})
    // MCP tool results come back as { content: [{ type: "text", text: "..." }] }
    // Extract the text content and parse it as JSON (trie always returns JSON).
    if (result && typeof result === "object" && "content" in (result as any)) {
      const content = (result as any).content
      if (Array.isArray(content) && content.length > 0 && content[0].type === "text") {
        try {
          return JSON.parse(content[0].text)
        } catch {
          return { raw: content[0].text }
        }
      }
    }
    return result
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { error: { code: "internal", message } }
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const desktopHandlers = HttpApiBuilder.group(DesktopApi, "desktop", (handlers) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const mcp = yield* MCP.Service
    const session = yield* Session.Service

    // -------------------------------------------------------------------
    // GET /desktop/event — graph canvas SSE stream
    // -------------------------------------------------------------------
    const eventHandler = Effect.fn("DesktopHttpApi.event")(function* () {
      log.info("desktop event stream connected")

      const allEvents = (yield* bus.subscribeAll()).pipe(
        Stream.takeUntil((e) => e.type === Bus.InstanceDisposed.type),
      )

      const heartbeat = Stream.tick("10 seconds").pipe(
        Stream.drop(1),
        Stream.map(() => desktopEvent("desktop.heartbeat", {})),
      )

      const mappedEvents = allEvents.pipe(
        Stream.filterMap((event) => {
          const mapped = mapBusEvent(event as any)
          return mapped !== null ? mapped : undefined
        }),
      )

      return HttpServerResponse.stream(
        Stream.make(desktopEvent("desktop.connected", {})).pipe(
          Stream.concat(mappedEvents.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
          Stream.pipeThroughChannel(Sse.encode()),
          Stream.encodeText,
          Stream.ensuring(Effect.sync(() => log.info("desktop event stream disconnected"))),
        ),
        {
          contentType: "text/event-stream",
          headers: {
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
          },
        },
      )
    })

    // -------------------------------------------------------------------
    // POST /desktop/session — create session
    // -------------------------------------------------------------------
    const sessionCreate = Effect.fn("DesktopHttpApi.session")(function* (ctx: {
      payload?: { title?: string }
      query: { directory?: string }
    }) {
      const info = yield* session.create({
        title: ctx.payload?.title ?? "trie desktop",
      })
      return info
    })

    // -------------------------------------------------------------------
    // GET /desktop/graph/all-symbols — full symbol list for initial load
    // Waits server-side for trie MCP to be connected before querying.
    // -------------------------------------------------------------------
    const allSymbols = Effect.fn("DesktopHttpApi.allSymbols")(function* (ctx: {
      query: { rank_by?: string; limit?: number }
    }) {
      // Poll until the trie MCP server is connected (up to 30s).
      // This avoids the frontend needing to retry — the connection race
      // is resolved here, once, before returning.
      const MAX_WAIT_MS = 30_000
      const POLL_MS = 500
      const deadline = Date.now() + MAX_WAIT_MS
      while (Date.now() < deadline) {
        const statuses = yield* mcp.status()
        const trieStatus = statuses["trie"]
        if (trieStatus?.status === "connected") break
        // Not connected yet — wait and retry
        yield* Effect.sleep(`${POLL_MS} millis`)
      }

      const tools = yield* mcp.tools()
      return yield* Effect.tryPromise(() =>
        callTrieTool(tools as any, "all_symbols", {
          rank_by: ctx.query.rank_by ?? "inbound_count",
          limit: ctx.query.limit ?? 5000,
        }),
      )
    })

    // -------------------------------------------------------------------
    // GET /desktop/graph/summary — project summary
    // -------------------------------------------------------------------
    const summary = Effect.fn("DesktopHttpApi.summary")(function* () {
      // mcp.tools() returns Effect.Effect — yield* it directly, don't wrap in tryPromise
      const tools = yield* mcp.tools()
      const result = yield* Effect.tryPromise(() => callTrieTool(tools as any, "summary", {}))
      return result
    })

    // -------------------------------------------------------------------
    // POST /desktop/graph/grep — proxy trie_grep
    // -------------------------------------------------------------------
    const grep = Effect.fn("DesktopHttpApi.grep")(function* (ctx: {
      payload: { predicate?: Record<string, unknown>; rank_by?: string; limit?: number }
    }) {
      const tools = yield* mcp.tools()
      return yield* Effect.tryPromise(() =>
        callTrieTool(tools as any, "grep", {
          predicate: ctx.payload.predicate ?? {},
          rank_by: ctx.payload.rank_by,
          limit: ctx.payload.limit,
        }),
      )
    })

    // -------------------------------------------------------------------
    // POST /desktop/graph/read — proxy trie_read
    // -------------------------------------------------------------------
    const read = Effect.fn("DesktopHttpApi.read")(function* (ctx: { payload: { qname: string } }) {
      const tools = yield* mcp.tools()
      return yield* Effect.tryPromise(() => callTrieTool(tools as any, "read", { qname: ctx.payload.qname }))
    })

    // -------------------------------------------------------------------
    // POST /desktop/graph/trace — proxy trie_trace
    // -------------------------------------------------------------------
    const trace = Effect.fn("DesktopHttpApi.trace")(function* (ctx: {
      payload: { from_qname: string; direction?: string; depth?: number }
    }) {
      const tools = yield* mcp.tools()
      return yield* Effect.tryPromise(() =>
        callTrieTool(tools as any, "trace", {
          from_qname: ctx.payload.from_qname,
          direction: ctx.payload.direction ?? "both",
          depth: ctx.payload.depth ?? 2,
        }),
      )
    })

    // -------------------------------------------------------------------
    // GET /desktop/graph/symbols-by-file — proxy trie_symbols_by_file
    // -------------------------------------------------------------------
    const symbolsByFile = Effect.fn("DesktopHttpApi.symbolsByFile")(function* (ctx: {
      query: { path: string }
    }) {
      const tools = yield* mcp.tools()
      return yield* Effect.tryPromise(() =>
        callTrieTool(tools as any, "symbols_by_file", { file_path: ctx.query.path }),
      )
    })

    return handlers
      .handleRaw("event", eventHandler)
      .handle("session", sessionCreate)
      .handle("allSymbols", allSymbols)
      .handle("summary", summary)
      .handle("grep", grep)
      .handle("read", read)
      .handle("trace", trace)
      .handle("symbolsByFile", symbolsByFile)
  }),
)
