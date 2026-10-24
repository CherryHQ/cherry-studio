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
selected Feishu scope, previews visible metadata, and reads supported Docx
Markdown. It does not create or update a Source, Document, KnowledgeItem, Job,
snapshot, embedding, or synchronization summary.

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
This is enough for a synchronizer to choose a canonical reference later; the
read adapter does not perform durable deduplication or reconciliation.

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
