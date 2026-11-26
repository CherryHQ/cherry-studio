# Agent Note: Desktop agent runtime capabilities

Status: proposed

English | [中文](2026-11-26-desktop-agent-runtime-capabilities.zh.md)

## Problem

The composer chooses a durable follow-up queue by agent type. The desktop connection decides independently whether it can take the input. The common submission interface accepts busy policies that the selected native access may reject. An installed CLI, a working protocol handshake and a particular thread's input rights each answer different questions.

## Proposal

Bind each input operation to the access that can execute it. Keep the caller's input ID and native admission result. A read-only access exposes no submission. A steering operation specifies the idle behavior; a native follow-up specifies whether it survives restart. An uncertain handoff retains its original target. Main owns dispatch. Pi Durable persists admitted follow-ups. For runtimes without durable admission, editable drafts stay in the existing composer queue. Place cross-harness contracts in the [runtime package](../../../../packages/agent-runtime/README.md).

Discovery, installation and launch use the same CLI component declaration from the desktop catalog. The Pi CLI installation identity is independent of the protocol used to open an existing session. Main owns binary selection, platform process execution, terminal login, host permissions and product billing. The Codex adapter owns the lifetime of its launched App Server and RPC connection. Run installed Pi through the bundled ACP bridge, embedded Pi through its SDK, Claude through the Claude package and standard ACP through [the existing adapter](../../../../packages/agent-runtime-acp/README.md). Preserve explicit ACP commands and the Codex App Server route. Live part and capability changes read only the affected source. Old local identities must resolve to the original native history before switching the restoration path.

An ACP harness with native behavior owns an independent `agent-runtime-<harness>-acp` package. It exports browser-safe CLI declarations for settings and implements native install recipes, launch policy, model configuration and protocol extensions as needed. Main registers the adapter and supplies process, filesystem, approval and gateway services. The common ACP package negotiates and routes native session updates for both registered harnesses and custom commands. The bundled Cursor SDK owns sign-in, model discovery and sessions. It runs its standard tools in the selected workspace and enforces native tool permissions. Cherry requests Cursor Auto-review, supplies the optional browser MCP lease and resumes sessions by SDK agent ID.

The CLI package declares its executable and distribution. The shared CLI contract carries the component identity and path resolved by the host. Discovery, installation verification and launch read the same component selection. Codex builds the stdio launch command, binds the RPC transport and closes the owned process after a probe or session. Probes only initialize or read the model catalog. Explicit executable wrappers can still supply their full command.

Desktop ACP adapters share the stdio process contract for chat and management. CodeBuddy declares its npm distribution in its package. Antigravity installation verification uses the same adapter selection as chat, including native ACP when the separate adapter is absent. Claude binds the resolved installation to its SDK launch and retains SDK-owned startup and shutdown.

Amp declares both installed components. Kiro and Vibe own their native installation recipes. Native account probes carry their command, output parser and exit policy together. Main executes the commands and routes login prompts. Each local launch reads the needed configuration files once. Harness packages interpret that configuration, and Main verifies the route and issues the scoped gateway credential.

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
- AC13 — Cursor creates and resumes chats by SDK agent ID in the selected workspace without a CLI. The selected model's standard toolset is available in both paths. Tool calls and native permission errors appear in the chat under the original call ID. (verification: unit and Electron)
- AC14 — OpenClaw restores through its adapter and suppresses bridge titles. A custom ACP command on the same desktop connection path follows negotiated recovery and retains its native title. Settings and chat consume the same CLI declaration. (verification: unit)
- AC15 — Codex installation and launch share the CLI component identity. Checks and model discovery open no native thread, and normal close, failed startup and cancellation all join the owned App Server process. (verification: unit and Electron)
- AC16 — CodeBuddy and Claude use their package declarations for installation and launch. Installing the Antigravity CLI alone suffices when the same native ACP component is selected by discovery and launch. ACP management and chat join their owned process on exit. (verification: unit and Electron)
- AC17 — Amp, Kiro and Vibe keep their native component and install behavior through package declarations. CLI account probes interpret success and signed-out exits using each harness's declared format. (verification: unit)
- AC18 — Changing native configuration during launch cannot make the launcher and gateway attribution interpret different reads of the same file. (verification: unit)

## Risks

An ACP session ID can differ from the Pi session file. Retain the legacy restoration path until identity has been established. Accepting a local request does not prove native placement. Configuration changes and disconnects can invalidate a previously displayed action.
