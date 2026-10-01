---
description: Contracts for trusted Feishu scope resolution, metadata preview, Wiki traversal, and Docx Markdown reads
sources:
  - src/main/features/knowledge/external
  - src/main/features/knowledge/KnowledgeService.ts
  - src/main/ipc/handlers/knowledge.ts
  - src/shared/data/types/externalKnowledgeRead.ts
  - src/shared/ipc/schemas/knowledge.ts
---

# External Knowledge Feishu Read Adapter

The Feishu read adapter is a stateless, main-process boundary owned by the
existing `KnowledgeService` and `ExternalKnowledgeRuntime`. It resolves a
selected Feishu scope, previews visible metadata, scans a persisted scope, and
reads supported Docx Markdown. The adapter itself does not create or update a
Source, Document, KnowledgeItem, Job, snapshot, embedding, or synchronization
summary; the Layer 4 workflow consumes its provider-neutral results and owns
those durable effects.

## Trust and IPC boundary

`knowledge.feishu.scope.resolve` and `knowledge.feishu.scope.preview` accept
only a Connection id and a user-entered URL. The URL parser accepts HTTPS
Feishu China `/wiki/{token}` and `/docx/{token}` URLs. It rejects credentials in
the URL, non-default ports, Lark hosts, arbitrary hosts, path traversal, and
unsupported paths before a provider request is admitted.

Only the validated token and URL kind enter provider operations. API requests
always use the fixed `https://open.feishu.cn` origin. Query strings and fragments
from the input URL do not enter the returned safe original URL. Renderer output
contains no access token, refresh token, App Secret, credential reference, raw
provider payload, or Feishu-specific traversal sidecar.

Resolve and preview are separate commands. Preview re-runs resolution from the
raw URL and does not accept a prior resolution or session handle as authority.
Its result is an ephemeral observation, not an initial-sync snapshot.

## Resolution and traversal

Strict provider decoding requires each Wiki node's space, node, object,
parent, type, title, child flag, and shortcut identity where applicable. A
direct Docx URL must resolve to the same Docx object token. Missing,
ill-typed, contradictory, duplicate, or wrong-parent data fails as an invalid
provider response.

Wiki preview includes the selected node and every visible descendant across all
pages. Unsupported intermediate nodes remain traversal parents. A cross-space
shortcut is visible and skipped, but is never followed outside the selected
space. A same-space shortcut resolves and validates its origin node, then
traverses that target with the shortcut-relative breadcrumb. Per-path origin
tracking stops shortcut cycles while allowing the same target to remain visible
through independent in-scope references. Those duplicate references increase
the visible count without increasing the unique supported Docx count.

Preview counts have deliberately different units:

- `visibleNodeCount` counts every visible reference, including the selected
  node, unsupported nodes, and shortcuts.
- `supportedDocxCount` counts unique supported Docx remote object identities.
- `unsupportedOrSkippedCount` counts each unsupported reference and each
  cross-space shortcut.
- `embeddingCostExact` is always `false` because preview never reads bodies or
  generates embeddings.
- A scope with no supported Docx object succeeds with the
  `no-supported-documents` warning.

The provider-neutral descriptor retains stable remote object identity, node and
parent identity, relative breadcrumb, title, safe original URL, remote revision,
document kind, and support state. Main-only validated Feishu data retains the
space id, node token, object token and type, node type, and shortcut origin ids.
The scan operation chooses one deterministic canonical reference for each
supported remote object before returning. It still performs no durable
deduplication or reconciliation: the Layer 4 synchronization workflow compares
the scan with persisted Documents and publishes the resulting changes.

## Source creation, synchronization, and lifecycle

`knowledge.external_source.create` accepts only a base id, connection id, raw
URL, and name. Main re-runs trusted scope resolution rather than accepting a
preview result as authority. Source creation, the initial durable Job enqueue,
and the `activeJobId` fence commit in one SQLite transaction. A failure in any
step leaves no Source or Job intent behind.

`knowledge.external_source.sync` accepts only a Source id. It re-reads the
Source, rejects paused Sources and failed bases, and enqueues the same
`knowledge.sync-external-source` Job used by initial synchronization. The
per-Source idempotency key coalesces repeated requests while a Job remains
non-terminal.

Sources default to manual-only scheduling. `knowledge.external_source.schedule.update`
can attach one daily schedule with a local time and IANA timezone, update that
schedule, or return the Source to manual-only mode. The Source owns provider-work
admission through its active/paused state; the JobManager schedule separately owns
its trigger, timezone, enabled state, and next run. Daily fires and startup catch-up
use a lightweight `knowledge.sync-external-source` dispatch envelope, then admit a
fresh provider-work Job through the same per-Source idempotency key used by initial
and manual synchronization.

Startup clears missing or terminal `activeJobId` correlations and waits for
JobManager recovery to settle previous-process non-terminal work before opening
provider admission. A restart never resumes an abandoned scan; a later trigger
starts a complete new scan.

One Job owns the full scan → per-document read/prepare/publication → missing
document reconciliation run. Provider reads and embedding preparation happen
outside the per-base mutation lock. Publication uses Source revision plus
active Job id fences; staged versioned snapshots and vectors become visible
only with their Document/KnowledgeItem ownership transaction. A complete scan
reconciles absence in one fenced batch, while a fatal or cancelled run never
interprets unseen documents as deleted.

The Job output and metadata contain only validated counts, stable error/warning
codes, and remote object ids. Credentials, account details, raw provider
payloads, and provider error messages are not written to Job rows or Source
summaries. Job settlement updates the Source only while its revision and
`activeJobId` still match, and DataApi read-model notifications are emitted
only after the owning transaction commits.

Terminal credential failures mark the Connection `reauthorization-required`,
pause every dependent Source, and disable their schedules. Successful
reauthorization restores those Sources and schedules without starting a sync.
Startup credential reconciliation applies the same paused state before provider
admission opens.

`knowledge.external_source.disconnect` has two local-only modes. Keep-local
removes Source/Document ownership while preserving completed snapshots, chunks,
vectors, and ownerless external items. Remove-local first marks every owned item
`deleting` and enqueues the existing durable subtree cleanup before removing the
ownership rows. Both modes unregister the schedule and settle active work before
destructive cleanup, preserve the shared Connection, and never mutate Feishu.
Keep-local does not retain a reattachment key, so connecting the same scope
again can create duplicate local content; merge and reattach remain unsupported.

## Docx Markdown

The only supported body operation is the official Docs content endpoint with
`doc_type=docx` and `content_type=markdown`. The adapter does not traverse
blocks, export Drive files, download raw files, or fall back to another content
source. It does not prepend the separately resolved Wiki title. Transport
normalization changes CRLF or CR line endings to LF and otherwise preserves the
provider Markdown, including frontmatter and placeholder text.

## Admission and endpoint budgets

Every provider call passes through the existing credential-scoped runtime lane.
Token refresh and identity validation remain single-flight, and generation
fences, abort signals, shutdown drain, Retry-After, and backoff remain owned by
that runtime. Each HTTP call is the retry unit, so a later page failure does not
replay earlier successful pages.

The runtime uses conservative intervals derived from the official endpoint
limits:

| Operation | Official limit | Minimum interval |
|---|---:|---:|
| [Wiki get node](https://open.feishu.cn/api-explorer?from=op_doc_tab&apiName=get_node&project=wiki&resource=space&version=v2) | 100 requests/minute | 600 ms |
| [Wiki list nodes](https://open.feishu.cn/api-explorer?from=op_doc_tab&apiName=list&project=wiki&resource=space.node&version=v2) | 100 requests/minute | 600 ms |
| [Docs get content](https://open.feishu.cn/api-explorer?from=op_doc_tab&apiName=get&project=docs&resource=content&version=v1) | 5 requests/second | 200 ms |

The budget state lives in the existing per-credential runtime state. There is no
application-wide limiter, provider registry, module-global queue, or adapter
singleton.

## Error boundary

The runtime and IPC boundary preserve these distinct outcomes:

- terminal connection authentication marks the Connection as
  `reauthorization-required`;
- missing required application or user scope reports `scope-missing`;
- resource ACL denial does not change Connection authorization state;
- a missing scope or node reports `scope-not-found`;
- an unsupported node reports `unsupported-resource` without invalidating the
  Connection;
- provider throttling and temporary failures report `transient` and honor
  Retry-After;
- invalid provider data reports `invalid-provider-response` without returning
  the private payload.

The adapter owns no long-lived resource or persistent side effect, so a new
lifecycle service is not justified. `KnowledgeService` remains the sole owner of
the existing stateful runtime.
