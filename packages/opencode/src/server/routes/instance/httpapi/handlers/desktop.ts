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

  // Full part upsert — carries the whole part (text, reasoning, tool with its
  // state transitions, file, patch). The desktop transcript upserts parts by id
  // from this, and the graph choreography derives tool activity from tool parts.
  if (type === "message.part.updated") {
    const part = (properties as any).part
    if (part)
      return desktopEvent("desktop.part.updated", {
        sessionID: part.sessionID,
        messageID: part.messageID,
        part,
      })
    return null
  }

  // Streaming deltas — split by field so chat text and reasoning stay distinct.
  if (type === "message.part.delta") {
    const field = (properties as any).field
    const base = {
      sessionID: properties.sessionID,
      messageID: properties.messageID,
      partID: properties.partID,
      delta: properties.delta,
    }
    if (field === "text") return desktopEvent("desktop.text.delta", base)
    if (field === "reasoning") return desktopEvent("desktop.reasoning.delta", base)
    return null
  }

  // Full message-info upsert — cost, tokens, finish reason, error.
  if (type === "message.updated") {
    const info = (properties as any).info
    if (info) return desktopEvent("desktop.message.updated", { sessionID: properties.sessionID, info })
    return null
  }

  // Session status — drives running/idle/error in the chat + graph.
  // opencode emits idle | retry | busy (never "running"/"error"); map busy ->
  // running so the UI shows a turn in progress.
  if (type === "session.status") {
    const status = (properties as any).status
    if (!status) return null
    const t = status.type === "busy" ? "running" : (status.type ?? "idle")
    return desktopEvent("desktop.session.status", {
      sessionID: properties.sessionID,
      status: { type: t, ...(status.error ? { error: status.error } : {}) },
    })
  }

  // Session error — surfaced as a chat error (dropped by the old mapper).
  if (type === "session.error") {
    const error = (properties as any).error
    return desktopEvent("desktop.session.status", {
      sessionID: (properties as any).sessionID,
      status: { type: "error", error: error?.data?.message ?? error?.message ?? "Agent error" },
    })
  }

  // Permission requested — the agent is asking to run/edit; the desktop renders
  // approve/deny inline on the originating tool row (joined via callID).
  if (type === "permission.asked") {
    const p = properties as any
    return desktopEvent("desktop.permission.asked", {
      id: p.id,
      sessionID: p.sessionID,
      permission: p.permission,
      patterns: p.patterns,
      metadata: p.metadata,
      always: p.always,
      callID: p.tool?.callID,
      messageID: p.tool?.messageID,
    })
  }

  // Permission resolved — dismiss the inline prompt across clients.
  if (type === "permission.replied") {
    const p = properties as any
    return desktopEvent("desktop.permission.replied", {
      sessionID: p.sessionID,
      requestID: p.requestID,
      reply: p.reply,
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
    const file = yield* File.Service

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
    // GET /desktop/graph/all-edges — full edge list for initial load
    // -------------------------------------------------------------------
    const allEdges = Effect.fn("DesktopHttpApi.allEdges")(function* (ctx: {
      query: { limit?: number }
    }) {
      // Same MCP-ready wait as allSymbols
      const MAX_WAIT_MS = 30_000
      const POLL_MS = 500
      const deadline = Date.now() + MAX_WAIT_MS
      while (Date.now() < deadline) {
        const statuses = yield* mcp.status()
        if (statuses["trie"]?.status === "connected") break
        yield* Effect.sleep(`${POLL_MS} millis`)
      }
      const tools = yield* mcp.tools()
      return yield* Effect.tryPromise(() =>
        callTrieTool(tools as any, "all_edges", { limit: ctx.query.limit ?? 50000 }),
      )
    })

    // -------------------------------------------------------------------
    // GET /desktop/graph/system-model — high-level system model for the graph view
    // -------------------------------------------------------------------
    const systemModel = Effect.fn("DesktopHttpApi.systemModel")(function* (ctx: {
      query: { landmark_limit?: number; include_tests?: string }
    }) {
      // Same MCP-ready wait as allSymbols/allEdges — this is an initial-load endpoint.
      const MAX_WAIT_MS = 30_000
      const POLL_MS = 500
      const deadline = Date.now() + MAX_WAIT_MS
      while (Date.now() < deadline) {
        const statuses = yield* mcp.status()
        if (statuses["trie"]?.status === "connected") break
        yield* Effect.sleep(`${POLL_MS} millis`)
      }
      const tools = yield* mcp.tools()
      return yield* Effect.tryPromise(() =>
        callTrieTool(tools as any, "system_model", {
          landmark_limit: ctx.query.landmark_limit ?? 160,
          include_tests: ctx.query.include_tests === "true",
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

    // -------------------------------------------------------------------
    // GET /desktop/graph/file-triefact — proxy trie_file_triefact
    // -------------------------------------------------------------------
    const fileTriefact = Effect.fn("DesktopHttpApi.fileTriefact")(function* (ctx: {
      query: { path: string }
    }) {
      const tools = yield* mcp.tools()
      return yield* Effect.tryPromise(() =>
        callTrieTool(tools as any, "file_triefact", { file_path: ctx.query.path }),
      )
    })

    // -------------------------------------------------------------------
    // GET /desktop/graph/file-source — raw source text for the editor
    // -------------------------------------------------------------------
    const fileSource = Effect.fn("DesktopHttpApi.fileSource")(function* (ctx: {
      query: { path: string }
    }) {
      const content = yield* file.read(ctx.query.path)
      return { path: ctx.query.path, type: content.type, content: content.content }
    })

    // -------------------------------------------------------------------
    // GET /desktop/graph/activity — proxy trie_activity (live status + stale)
    // -------------------------------------------------------------------
    const activity = Effect.fn("DesktopHttpApi.activity")(function* () {
      const tools = yield* mcp.tools()
      return yield* Effect.tryPromise(() => callTrieTool(tools as any, "activity", {}))
    })

    // -------------------------------------------------------------------
    // Patch endpoints — proxy the trie patch MCP tools.
    // -------------------------------------------------------------------
    const patches = Effect.fn("DesktopHttpApi.patches")(function* () {
      const tools = yield* mcp.tools()
      return yield* Effect.tryPromise(() => callTrieTool(tools as any, "patch_list", {}))
    })

    const patchDrop = Effect.fn("DesktopHttpApi.patchDrop")(function* (ctx: {
      payload?: { qname?: string }
    }) {
      const tools = yield* mcp.tools()
      return yield* Effect.tryPromise(() =>
        callTrieTool(tools as any, "patch_drop", ctx.payload?.qname ? { qname: ctx.payload.qname } : {}),
      )
    })

    const patchApply = Effect.fn("DesktopHttpApi.patchApply")(function* () {
      const tools = yield* mcp.tools()
      return yield* Effect.tryPromise(() => callTrieTool(tools as any, "patch_apply", {}))
    })

    return handlers
      .handleRaw("event", eventHandler)
      .handle("session", sessionCreate)
      .handle("allSymbols", allSymbols)
      .handle("allEdges", allEdges)
      .handle("systemModel", systemModel)
      .handle("summary", summary)
      .handle("grep", grep)
      .handle("read", read)
      .handle("trace", trace)
      .handle("symbolsByFile", symbolsByFile)
      .handle("fileTriefact", fileTriefact)
      .handle("fileSource", fileSource)
      .handle("activity", activity)
      .handle("patches", patches)
      .handle("patchDrop", patchDrop)
      .handle("patchApply", patchApply)
  }),
)
