import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"

const root = "/desktop"

export const DesktopPaths = {
  event: `${root}/event`,
  session: `${root}/session`,
  summary: `${root}/graph/summary`,
  grep: `${root}/graph/grep`,
  read: `${root}/graph/read`,
  trace: `${root}/graph/trace`,
  symbolsByFile: `${root}/graph/symbols-by-file`,
} as const

// ---------------------------------------------------------------------------
// Request / response schemas
// ---------------------------------------------------------------------------

export const GrepPayload = Schema.Struct({
  predicate: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  rank_by: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
})

export const ReadPayload = Schema.Struct({
  qname: Schema.String,
})

export const TracePayload = Schema.Struct({
  from_qname: Schema.String,
  direction: Schema.optional(Schema.String),
  depth: Schema.optional(Schema.Number),
})

export const SymbolsByFileQuery = Schema.Struct({
  path: Schema.String,
})

// Generic JSON response — trie returns arbitrary JSON objects.
// We pass them through as opaque records so the desktop app gets the
// full trie envelope without us having to mirror every trie schema.
const JsonAny = Schema.Any

// ---------------------------------------------------------------------------
// API group definition
// ---------------------------------------------------------------------------

export const DesktopApi = HttpApi.make("desktop").add(
  HttpApiGroup.make("desktop")
    .add(
      // SSE stream for the graph canvas — graph-canvas-specific events
      // derived from the opencode internal bus.
      HttpApiEndpoint.get("event", DesktopPaths.event, {
        query: WorkspaceRoutingQuery,
        success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.event",
          summary: "Desktop graph canvas event stream",
          description: "SSE stream emitting graph-canvas-specific events for the trie desktop app.",
        }),
      ),
    )
    .add(
      // Create a new session scoped to the open project directory.
      HttpApiEndpoint.post("session", DesktopPaths.session, {
        query: WorkspaceRoutingQuery,
        payload: [HttpApiSchema.NoContent, Schema.Struct({ title: Schema.optional(Schema.String) })],
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.session.create",
          summary: "Create desktop session",
          description: "Create a new session for the desktop app.",
        }),
      ),
    )
    .add(
      // Project summary — symbol/edge counts + trie version.
      HttpApiEndpoint.get("summary", DesktopPaths.summary, {
        query: WorkspaceRoutingQuery,
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.summary",
          summary: "Graph project summary",
          description: "Returns aggregate symbol/edge counts for the project.",
        }),
      ),
    )
    .add(
      // Grep symbols — proxies trie_grep MCP tool.
      HttpApiEndpoint.post("grep", DesktopPaths.grep, {
        query: WorkspaceRoutingQuery,
        payload: GrepPayload,
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.grep",
          summary: "Grep symbols",
          description: "Search the trie symbol graph by predicate.",
        }),
      ),
    )
    .add(
      // Read symbol — proxies trie_read MCP tool.
      HttpApiEndpoint.post("read", DesktopPaths.read, {
        query: WorkspaceRoutingQuery,
        payload: ReadPayload,
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.read",
          summary: "Read symbol",
          description: "Read full prose + callers/callees for a symbol qname.",
        }),
      ),
    )
    .add(
      // Trace symbol — proxies trie_trace MCP tool.
      HttpApiEndpoint.post("trace", DesktopPaths.trace, {
        query: WorkspaceRoutingQuery,
        payload: TracePayload,
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.trace",
          summary: "Trace symbol",
          description: "Trace the call graph outward from a symbol.",
        }),
      ),
    )
    .add(
      // Symbols by file — convenience for sidebar file clicks.
      HttpApiEndpoint.get("symbolsByFile", DesktopPaths.symbolsByFile, {
        query: Schema.extend(WorkspaceRoutingQuery, SymbolsByFileQuery),
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.symbolsByFile",
          summary: "Symbols by file",
          description: "Return all symbols in a given source file.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization)
    .annotateMerge(
      OpenApi.annotations({
        title: "desktop",
        description: "Desktop app route group — graph canvas SSE and trie graph query endpoints.",
      }),
    ),
)
