# Agent Note: Desktop agent runtime capabilities

Status: proposed

English | [中文](2026-11-26-desktop-agent-runtime-capabilities.zh.md)

## Problem

The composer chooses a durable follow-up queue by agent type. The desktop connection decides independently whether it can take the input. The common submission interface accepts busy policies that the selected native access may reject. An installed CLI, a working protocol handshake and a particular thread's input rights each answer different questions.

## Proposal

Bind each input operation to the access that can execute it. Keep the caller's input ID and native admission result. A read-only access exposes no submission. A steering operation specifies the idle behavior; a native follow-up specifies whether it survives restart. An uncertain handoff retains its original target. Main owns dispatch. Pi Durable persists admitted follow-ups. For runtimes without durable admission, editable drafts stay in the existing composer queue. Place cross-harness contracts in the [runtime package](../../../../packages/agent-runtime/README.md).

Discovery, installation and launch share desktop component declarations in the existing shared presets. The Pi CLI installation identity is independent of the protocol used to open an existing session. Keep process ownership, terminal login, permissions and product billing in Main. Run installed Pi through the bundled ACP bridge, embedded Pi through its SDK, Claude through the Claude package and standard ACP through [the existing adapter](../../../../packages/agent-runtime-acp/README.md). Preserve explicit ACP commands and the Codex App Server route. Live part and capability changes read only the affected source. Old local identities must resolve to the original native history before switching the restoration path.

Pi and Grok implement their private ACP operations in their own packages. For Cursor, the local SDK owns new sessions, model discovery and sign-in. Main supplies turn-scoped tools. Writes, edits and commands need a Cherry approval bound to their arguments and the live turn. Present only host tools and the configured browser lease. Explicit ACP commands and unprefixed Cursor resume tokens keep the legacy adapter.

## Alternatives considered

A provider-wide boolean cannot express read-only child access, a volatile queue or a model-specific writable option. A second desktop client for the installed Pi CLI would duplicate the bridge’s streaming, cancellation and restoration. A future native route needs a product operation or measured benefit that justifies maintaining it.

## Acceptance criteria

- AC1 — The access for ordinary ACP, a managed Pi child and a durable root exposes only supported input operations and their actual guarantees. (verification: unit)
- AC2 — Lost receipts and stale connections never cause a second submission to another native thread. (verification: unit)
- AC3 — The composer selects direct durable follow-up from the current connection and uses its draft queue when that operation is unavailable. (verification: renderer)
- AC4 — Pi and Amp installation, version, login and chat reference the actual components required for each purpose. (verification: unit)
- AC5 — A real desktop ACP connection sends, approves or rejects a tool, cancels and joins its process under the selected host policy. (verification: Electron)
- AC6 — Probing and closing an observer preserve the active owner, and replay does not duplicate a message or charge. (verification: Electron)
- AC7 — Appending one native part or changing one input capability in a 20,000-message thread visits no prior history from production through renderer delivery. (verification: Electron)
- AC8 — Opening an old local context retains its original history or reports the failed restoration without creating a replacement thread. (verification: unit)
- AC9 — Local Pi and Claude use the selected installation, settings and history, while explicit ACP overrides retain ACP behavior. (verification: Electron)
- AC10 — Options, resource catalogs, targeted history operations, usage and child control require evidence from their respective owners. (verification: unit)
- AC11 — A provider extension executes only a negotiated and implemented operation, with unknown delivery distinct from explicit non-admission. (verification: unit)
- AC12 — Packaged management, launch and restoration paths work after removing superseded readers and component declarations. (verification: packaged artifact)
- AC13 — A new Cursor chat uses the SDK without a CLI. An old ACP session resumes with its original identity. A denied, cancelled or read-only host tool call cannot mutate a file or start a process. (verification: unit and Electron)

## Risks

An ACP session ID can differ from the Pi session file. Retain the legacy restoration path until identity has been established. Accepting a local request does not prove native placement. Configuration changes and disconnects can invalidate a previously displayed action.
