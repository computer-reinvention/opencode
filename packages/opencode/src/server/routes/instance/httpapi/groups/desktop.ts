import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"

const root = "/desktop"

export const DesktopPaths = {
  event: `${root}/event`,
  session: `${root}/session`,
  summary: `${root}/graph/summary`,
  allSymbols: `${root}/graph/all-symbols`,
  allEdges: `${root}/graph/all-edges`,
  systemModel: `${root}/graph/system-model`,
  grep: `${root}/graph/grep`,
  read: `${root}/graph/read`,
  trace: `${root}/graph/trace`,
  symbolsByFile: `${root}/graph/symbols-by-file`,
  fileTriefact: `${root}/graph/file-triefact`,
  fileSource: `${root}/graph/file-source`,
  activity: `${root}/graph/activity`,
  patches: `${root}/graph/patches`,
  patchDrop: `${root}/graph/patch-drop`,
  patchApply: `${root}/graph/patch-apply`,
  blastRadius: `${root}/graph/blast-radius`,
} as const

// ---------------------------------------------------------------------------
// Request / response schemas
// ---------------------------------------------------------------------------

export const AllSymbolsQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  rank_by: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
})

export const AllEdgesQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  limit: Schema.optional(Schema.NumberFromString),
})

export const SystemModelQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  landmark_limit: Schema.optional(Schema.NumberFromString),
  // string "true"/"false" — parsed in the handler (no BooleanFromString in this effect ver)
  include_tests: Schema.optional(Schema.String),
})

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
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

export const FileTriefactQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

export const FileSourceQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

export const PatchDropPayload = Schema.Struct({
  qname: Schema.optional(Schema.String),
})

export const BlastRadiusQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  qname: Schema.String,
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
      // All symbols — dedicated initial-load endpoint, no predicate required.
      HttpApiEndpoint.get("allSymbols", DesktopPaths.allSymbols, {
        query: AllSymbolsQuery,
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.allSymbols",
          summary: "All symbols",
          description: "Return all symbols for initial graph population. No predicate required.",
        }),
      ),
    )
    .add(
      // All edges — dedicated initial-load endpoint, returns all call-graph edges.
      HttpApiEndpoint.get("allEdges", DesktopPaths.allEdges, {
        query: AllEdgesQuery,
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.allEdges",
          summary: "All edges",
          description: "Return all call-graph edges for initial graph population.",
        }),
      ),
    )
    .add(
      // System model — high-level model of the system for the graph view.
      HttpApiEndpoint.get("systemModel", DesktopPaths.systemModel, {
        query: SystemModelQuery,
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.systemModel",
          summary: "System model",
          description:
            "Return the high-level system model: classified+scored nodes, role summaries, role-to-role flow edges, and landmark set.",
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
        query: SymbolsByFileQuery,
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.symbolsByFile",
          summary: "Symbols by file",
          description: "Return all symbols in a given source file.",
        }),
      ),
    )
    .add(
      // File triefact — full triefact (front matter + ordered sections) for a source file.
      HttpApiEndpoint.get("fileTriefact", DesktopPaths.fileTriefact, {
        query: FileTriefactQuery,
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.fileTriefact",
          summary: "File triefact",
          description: "Return the full triefact (front matter + per-symbol sections) for a source file.",
        }),
      ),
    )
    .add(
      // File source — raw source text for the editor's source view.
      HttpApiEndpoint.get("fileSource", DesktopPaths.fileSource, {
        query: FileSourceQuery,
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.fileSource",
          summary: "File source",
          description: "Return the raw source text for a file, for the editor source view.",
        }),
      ),
    )
    .add(
      // Activity — live writer status + working-tree stale set (polled).
      HttpApiEndpoint.get("activity", DesktopPaths.activity, {
        query: WorkspaceRoutingQuery,
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.activity",
          summary: "Activity",
          description: "Return the live trie writer status and the working-tree stale set.",
        }),
      ),
    )
    .add(
      // Patches — pending patches grouped by symbol (patch_list).
      HttpApiEndpoint.get("patches", DesktopPaths.patches, {
        query: WorkspaceRoutingQuery,
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.patches",
          summary: "Patches",
          description: "Return all pending patches grouped by symbol.",
        }),
      ),
    )
    .add(
      // Drop patches for a symbol (or all this session when qname omitted).
      HttpApiEndpoint.post("patchDrop", DesktopPaths.patchDrop, {
        query: WorkspaceRoutingQuery,
        payload: PatchDropPayload,
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.patchDrop",
          summary: "Drop patches",
          description: "Remove pending patches for a symbol, or all this session.",
        }),
      ),
    )
    .add(
      // Apply all pending patches.
      HttpApiEndpoint.post("patchApply", DesktopPaths.patchApply, {
        query: WorkspaceRoutingQuery,
        payload: [HttpApiSchema.NoContent, Schema.Struct({ session_note: Schema.optional(Schema.String) })],
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.patchApply",
          summary: "Apply patches",
          description: "Apply all pending patches (merge, generate, cascade, commit).",
        }),
      ),
    )
    .add(
      // Blast radius — cascade impact of editing a symbol (real compute_cascade).
      HttpApiEndpoint.get("blastRadius", DesktopPaths.blastRadius, {
        query: BlastRadiusQuery,
        success: JsonAny,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "desktop.graph.blastRadius",
          summary: "Blast radius",
          description: "Cascade impact (with hop distances) of editing a symbol.",
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
