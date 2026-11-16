# Agent Note: Keep image bytes off agent observation and request paths

Status: proposed

English | [中文](2026-11-16-agent-image-byte-paths.zh.md)

## Problem

[#24500](https://github.com/CherryHQ/cherry-studio/pull/24500) diagnosed a main-process V8 OOM in image-heavy Durable sessions and bounded several amplifiers: SDK telemetry payloads, a 16 MiB per-observer backlog budget, container-only history copies and a 64 MiB native payload admission. Those bounds limit how many copies can coexist. They do not change why each copy is history-sized. This audit reads `origin/main` at `6b4081181414` and the #24500 head at `bd60450b797d`.

Three structural properties remain.

**Observation republishes the whole history on every change.**

- Durable calls `DurableProjection.update` for every native view value, including deferred in-memory progress previews ([runtime](../../../../packages/agent-runtime-pi-durable/src/runtime.ts), attach callbacks). Each call builds a new `ContentProjection` from every active entry, creates a new data URL for every image, and publishes a full `snapshot` ([projection](../../../../packages/agent-runtime-pi-durable/src/projection.ts), [content](../../../../packages/agent-runtime-pi-durable/src/content.ts)). `input`, `beginAdmission` and `endAdmission` take the same path for input-only changes. Pi and ACP already publish `message.upsert`. Durable is the only adapter whose steady state is a full snapshot, although the [runtime contract](2026-10-17-agent-runtime-contract.md) specifies snapshot-then-upsert delivery.
- [`ThreadFeed`](../../../../packages/agent-runtime/src/observation.ts) copies each published event, copies it again for each observer, and queues frames per observer. A frame marked critical also captures a full recovery snapshot; overflow recovery substitutes retained and current snapshots. #24500 bounds this backlog by count and estimated bytes, and closes the observation with `source-lost` when critical frames exceed the budget. Its estimate counts a shared image string once per frame. An image-heavy session whose slow observer holds two pending terminal frames is therefore closed with `source-lost`, and the Durable turn fails, even though both frames share one image in memory.
- Main reduces every message of every snapshot. [ThreadMessageProjection](../../../../src/main/ai/agentSession/ThreadMessageProjection.ts) projects, decorates and deep-compares each message. [RootMessageProjection](../../../../src/main/ai/agentSession/RootMessageProjection.ts) deep-compares accumulated parts before it republishes the whole product reply to the live controller or to `replaceMessageParts`.

Per change, the cost is O(history). The number of changes grows with the history, and a slow observer multiplies the retained history.

**Main keeps and resends whole product bodies.** Tool outputs keep native `{ type: 'image', data }` blocks, and these are persisted inline in the JSON `data` column of `agent_session_message`. Inline storage predates the agent runtime: the earlier Claude and Pi stream adapters wrote tool-output images the same way. It was not on a hot path then, because Main read rows on demand without keeping them, and DataApi reads still hand the renderer deferred references for large tool outputs. Two structures added with the desktop cutover ([#22856](https://github.com/CherryHQ/cherry-studio/pull/22856)) put whole bodies on the hot path:

- One product reply row joins the parts of several native source messages with parts that Cherry adds, such as task events. The root checkpoint records only each source's offset and count, and `replaceMessageParts` replaces the whole row. To rebuild a row when one source or extra changes, [RootMessageProjection](../../../../src/main/ai/agentSession/RootMessageProjection.ts) reads every row named by the context's root mapping when it is constructed. It also keeps the parts of every source it accepts. Nothing is released while the session's runtime entry lives. The late changes that need a rebuild are background results, task events, approval retirement and Claude's full refresh, and all of them only need to find the owning reply and then rewrite that one row.
- [MessageProjection](../../../../src/main/ai/messages/MessageProjection.ts) sends the whole message over `ai.projection.changed` for any change other than text growth. Each new tool part or state change in a reply that already holds images resends those images.

**Each native model call makes an HTTP round trip inside the same process and revalidates every image.** Native Pi providers send requests to the internal gateway listener on `127.0.0.1` ([binding](../../../../src/main/ai/runtime/pi/gatewayModelBinding.ts)). One call takes these steps in order:

1. Pi serializes the wire request.
2. Fetch encodes the request for the socket.
3. The gateway buffers and parses the body.
4. The dialect converter builds a new data URL for each image.
5. `prepareChatMessages` decodes every history image that lacks a `fileEntryId` into a `Buffer` and runs a strict sharp pixel decode on it (`materializeNativeFilePart` in [fileProcessor](../../../../src/main/ai/messages/fileProcessor.ts)).
6. AI SDK serializes the provider request again.

The model needs one provider request. The other copies and the repeated pixel decode exist only because an in-process call has the shape of a remote request.

## Proposal

Image bytes should cost O(1) per image in the host, not O(history × changes × observers × calls). The model must see the same content: no history truncation and no resubmitted work. The three phases ship as independent stacked layers, and each phase is useful on its own.

### P1 — Observation shares frozen values and reuses unchanged messages

Delivery semantics stay as they are: ordered frames per observer, capture at publication, count-based overflow with critical-frame retention, and snapshots from Durable. What changes is that a frame no longer carries its own copy of history.

1. **`ThreadFeed` shares frozen values instead of copying them.** A new `immutable()` helper in `@cherrystudio/agent-runtime` copies a publisher's containers once and freezes the copy. Values it froze earlier are reused, and strings are always shared.
   - The stored snapshot, `state`, `message(id)`, captured metadata and every observer delivery are the same frozen objects.
   - The publisher's own objects are never frozen, so adapters may keep mutating native or working state.
   - A consumer that mutates a delivered value fails at the mutation site, and existing observer-failure isolation applies.
   - Republishing an unchanged message from `snapshot` or from an adapter's own `immutable()` cache keeps its identity. A pending snapshot frame then costs O(messages) pointers instead of a copy of every message container.
   - The #24500 byte budget is removed. Frames share history, and its per-frame estimate is what closes image-heavy observers.
2. **Durable reuses its committed projection.** Native views append the same `EntryRecord` objects, and compaction replaces the prefix.
   - The projection caches its committed layer and projects only entries appended after an identical prefix. Any other view rebuilds once.
   - `ContentProjection` becomes copy-on-write. Committed messages are frozen after each append. A later tool result, nested call or live progress copies only the message it changes; live overlays are applied to a fork and never reach the committed layer.
   - Each image's data URL is built once per committed entry rather than once per view.
   - Durable keeps publishing snapshots. Unchanged messages keep their identity in them.
3. **Main skips work for unchanged sources.** `ThreadMessageProjection` reuses the previous view when a message's source object is unchanged and the message is not explicitly invalidated, so it neither decorates nor compares it. With shared references, the remaining deep comparisons in Main return at the first identical reference.

4. **Claude Code and Pi adapters capture once.**
   - `ClaudeFeed` freezes each batch and native message once. Its retained native map, every observer delivery and every recovery baseline share them, so a critical frame held for a stalled observer costs pointers instead of a container copy of all native history.
   - Pi captures non-delta native events, completed tool arguments, context rebuilds and background results with `immutable()` instead of `structuredClone`. This keeps the capture-at-emission guarantee without serializing image data for every event.

P1 changes no observation event, ordering rule or delivery count. It partially supersedes the #24500 observation-retention decision: the byte budget and its fail-closed path are removed.

### P2 — Main keeps indexes instead of product bodies and sends changed parts

1. **The root projection keeps an index resident.**
   - For each product reply it keeps the source ranges, the owner of each tool call and the approval state. Late changes find their owning reply through this index.
   - Parts of a live reply that is not yet persisted stay in memory as today. They are the shared observation values from P1.
   - Once a reply is persisted, the projection releases its parts. Constructing a projection reads rows only to build the index.
2. **A late change reads its row on demand.** Inside one `withWriteTx` transaction, Main reads the owning row, replaces the changed source range or extra, and writes the row. A Claude refresh reads the rows it compares and rewrites only rows whose parts changed.
3. **Projection updates carry changed parts.**
   - `MessageProjection` publishes a part patch for each changed part, together with the message's part count and the message order. Unchanged parts, images included, are not resent.
   - Text growth keeps its append patch. Role or metadata changes and new messages still send the whole message.
   - The renderer and child-view consumers apply part patches to their views.
4. **What does not change.** The persisted row format, rows written before or after this change, and the model context stay as they are. No data is migrated.

### P3 — Native model calls stay in process and validate each image once

1. **In-process callers use no socket.** The Pi binding injects a `fetch` that dispatches to the internal gateway's request handling inside the process, with the same headers, credential, signal and wire body.
   - These keep their current owners: authentication, credential scope, internal-only controls, usage capture, the response-ID join, trace context, error envelopes (including status mapping before the first chunk), the startup barrier and cancellation.
   - External listeners keep HTTP: the Claude Code subprocess, PDF translation, code CLIs, paired devices and external clients.
2. **No second parse when the request object is available.** Pi exposes the provider request object through `onPayload`, before serialization. The binding registers that object under a per-call key, and the in-process dispatch hands it to the gateway core instead of parsing the serialized body. When the object is unavailable, the dispatch parses the body as it does today. Pi's own serialization remains, because Pi's provider SDK owns it.
3. **Validate each image once per content.** `materializeNativeFilePart` caches its decision (valid, rejected, or a padded replacement) by content hash, byte length and media type. Repeated history images then skip the base64 decode and the sharp pixel decode. The cache is bounded and holds only decisions and small padded results.
4. **The wire dialect stays the contract.** The gateway still receives the native Pi dialect and still owns provider execution. Thinking signatures, cache control, tool-call identity and retry classification therefore keep their tested path. This proposal does not add a custom in-process `streamSimple` that bypasses the dialect (see Alternatives considered).

After P3, the #24500 payload admission is re-evaluated against measurements. It stays unless the AC11 evidence shows that the concurrent working set no longer needs it.

## Alternatives considered

- Keep the #24500 bounds as the final state: rejected. Each remaining copy stays history-sized, and work per change stays O(history). The bounds only cap the multiplier, and they still allow a single oversized frame or request.
- Keep cloning in `ThreadFeed` and only make Durable incremental: rejected. Per-observer copies and full recovery snapshots would remain, and those copies are what make slow observers retain history.
- Share values without freezing: rejected. Mutation by another observer or by the publisher would become silent corruption instead of an immediate failure.
- Replace frame queues with per-observer coalescing (dirty message IDs plus an ordered fact queue) and have Durable publish upserts: deferred. Once frames share values, a pending frame costs pointers rather than history. Coalescing would also change delivery counts, completion ordering and recovery semantics that #24500 and the reply-ownership work verified.
- Convert runtime images into FileManager `fileEntryId` references at the Main boundary: deferred. It shrinks the bodies that Main keeps and resends, but the cause is that Main keeps whole bodies and that its update unit is the whole message. It would also need collision-safe content lookup, a ref-role migration and retention for live unpersisted views. Rows that already hold inline images would be rewritten piecemeal by Claude refresh comparisons, or would create and clean up entries every time a session reopens, unless they were migrated. With P2, row size, database size and renderer memory remain; revisit them if AC11 evidence shows they matter.
- Prune or downscale historical images: rejected, because it changes the context the model sees.
- Provider file APIs (Anthropic, OpenAI or Gemini file IDs) for history images: deferred. They would shrink requests further, but they depend on provider support and need a product decision on upload lifecycle and privacy.
- A custom Pi `streamSimple` that converts Pi context directly to Cherry messages: rejected for now. It removes the most copies, but it brings back a bespoke in-process model protocol of the kind the [harness boundaries](2026-10-17-agent-harness-boundaries.md) decision removed. It would also have to reimplement thinking replay, tool pairing, cache control and retry error shapes.
- Move native runtimes into a utility process: deferred. It limits the blast radius of an OOM but does not reduce the copies. After P1 and P2, observation traffic is small enough to make this cheaper to evaluate.

## Acceptance criteria

- AC1 — ThreadFeed stores and delivers one frozen copy of each published value: every observer receives the same objects, mutating a delivered or stored value throws without affecting other observers, and a publisher's later edits do not change published values. (verification: unit — `packages/agent-runtime` observation and immutable tests; owner: P1 implementer)
- AC2 — A stalled observer's pending frames share history: 90 republished snapshots of a 2,000-message history retain under 16 MiB and are all delivered, two pending terminal frames that share a 9 MiB image keep the observation open, and count-based overflow, `source-lost` and baseline-first ordering are retained. (verification: unit with heap measurement; owner: P1 implementer)
- AC3 — Durable projects each committed entry once per native window: unchanged messages keep their identity across views, a later tool result or live progress copies only the affected message without changing earlier snapshots or the committed layer, and a view that does not extend the previous entries rebuilds. (verification: unit — Durable projection with native view shapes; owner: P1 implementer)
- AC4 — Observation events, ordering, completion capture, recovery and reply ownership are unchanged: the existing runtime package suites and the Main agent-session, runtime and message suites pass. (verification: unit — package suites and scoped Main tests; owner: P1 implementer)
- AC5 — Main projections reuse the previous view of an unchanged source without decorating it again, and explicit invalidation still re-decorates. A stalled Claude observer holding 90 critical frames over 2,000 native messages retains under 16 MiB, and a Pi native fact mutated after emission is projected as emitted. (verification: unit — ThreadMessageProjection, Claude observation, Pi runtime projection; owner: P1 implementer)
- AC6 — Once a session context is open, Main keeps no persisted reply bodies: the root projection retains source ranges, tool-call owners and approval state, and a reply's parts are released after it is persisted. (verification: unit — RootMessageProjection with `setupTestDatabase`; owner: P2 implementer)
- AC7 — A late background result, task event, approval retirement or Claude refresh writes the same row content as before by reading the owning row on demand in one write transaction, and a refresh rewrites only rows whose parts changed. (verification: unit and database — AgentSessionRuntimeService and RootMessageProjection with `setupTestDatabase`; owner: P2 implementer)
- AC8 — Projection updates carry only changed parts: adding or changing one part does not resend unchanged parts, including images, and renderer and child views converge to the same messages as with whole-message updates. (verification: unit — MessageProjection and renderer projection consumers; owner: P2 implementer)
- AC9 — In-process native model calls open no socket, the existing gateway contracts for authentication, internal controls, usage and response-ID attribution, tracing, error envelopes, cancellation and HTTP 413 hold on the in-process path, and external callers keep HTTP. (verification: unit — gateway and binding integration tests; owner: P3 implementer)
- AC10 — A native call whose request object is available performs no gateway-side parse of the serialized body, and repeated history images skip base64 and sharp decoding after their first validation while padding results stay identical. (verification: unit — binding and fileProcessor tests; owner: P3 implementer)
- AC11 — The #24500 workload shape, one session dispatching four image-reading Durable subagents, runs 30 minutes in a development Electron build without OOM, and the report records main-process heap, external memory and model-call counts against the #24500 baseline. (verification: Electron; owner: final implementation integrator)
- AC12 — The runtime README, the observability and gateway references and this note's triplet describe the shipped delivery, persistence and transport semantics, and each superseded #24500 bound is removed or justified by AC11 evidence. (verification: docs gate; owner: final implementation integrator)

## Risks

- Freezing turns in-place mutation of delivered values into runtime errors. The runtime package suites and the Main agent-session, runtime and message suites pass, but an untested consumer path could still fail; such a failure stops that observer and is reported.
- Non-plain values (dates, typed arrays, errors) cannot be frozen. They are copied once from the publisher and then shared unfrozen.
- Incremental Durable projection relies on native views reusing entry objects for an unchanged prefix. Pi Durable 1.5.2 does so; a native change that returns new objects only loses the reuse, because the identity check then rebuilds.
- On-demand reads move a row parse into each late change. A persisted reply that holds many inline images costs that parse for every task event or background result it receives. AC11 measures this, and it is the evidence that would reopen the deferred file-reference alternative.
- Part patches change the projection IPC protocol. Main and the renderer ship together, but every projection consumer, topic and child views included, must apply them.
- The P3 in-process dispatch must reproduce the error envelopes that Elysia's error handler produces today. Any divergence changes Pi's retry classification. Anthropic `fetch` injection has no existing repository test.
- AC11 is a development-build measurement, not acceptance on a Windows packaged build. The original Windows workload remains a separate verification.
