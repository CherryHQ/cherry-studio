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

**Image bytes are inline in product content.** The Pi, Durable and Claude adapters convert native images into `data:` URL file parts, and tool outputs keep native `{ type: 'image', data }` blocks. These strings pass through every Main projection, the single JSON `data` column of `agent_session_message`, and `ai.projection.changed` IPC. [MessageProjection](../../../../src/main/ai/messages/MessageProjection.ts) deep-compares its view on every flush and sends the whole message for any non-text change. Cherry already stores user attachments as FileManager entries referenced by `cherry.fileEntryId`; message file refs keep them alive, and `MessageImageBlock` renders them by entry. Runtime-produced images bypass that mechanism.

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

### P2 — Images in product content become file references

1. **Externalize once at the host boundary.** Before `ThreadMessageProjection` reduces an event, an asynchronous host step replaces each inline image with a FileManager internal entry. This covers images in file parts and image blocks in tool outputs. It is the first Main step that root and child projections of every runtime share, and their accept chain is already serialized and asynchronous.
   - Entries are found or created by content hash, byte length and media type. The lookup must be collision-safe, because `contentHash` is xxh3 and not unique.
   - Entries use `cleanupPolicy: delete_when_unreferenced`.
   - For committed messages, the step caches results by message ID and part path, so a re-upserted message is not hashed again.
2. **Use the existing reference shape.** File parts become `{ type: 'file', mediaType, url: <entry file URL>, providerMetadata: { cherry: { fileEntryId } } }`. This matches user attachments, and `MessageImageBlock` already renders it. Image blocks in tool outputs become reference blocks that carry `fileEntryId` and the media type in place of `data`. Agent tool renderers that read inline base64 today resolve the reference through the same entry lookup.
3. **Reference ownership.**
   - `agent_session_message_file_ref` gains a role for tool-output images; an appended migration extends its role check.
   - The ref scan includes tool-output reference blocks.
   - Entries referenced by a live view that is not yet persisted stay retained until the message is persisted or the view closes, so the cleanup grace period cannot delete an image during a long turn.
4. **What does not change.**
   - Native runtime storage and native model context keep their own image bytes, so model requests stay byte-identical.
   - Persisted rows that already contain data URLs remain readable and are not rewritten.
   - Two image copies remain in memory, each held once rather than multiplied: the native runtime's own value, and the adapter's projected value in the feed state.

### P3 — Native model calls stay in process and validate each image once

1. **In-process callers use no socket.** The Pi binding injects a `fetch` that dispatches to the internal gateway's request handling inside the process, with the same headers, credential, signal and wire body.
   - These keep their current owners: authentication, credential scope, internal-only controls, usage capture, the response-ID join, trace context, error envelopes (including status mapping before the first chunk), the startup barrier and cancellation.
   - External listeners keep HTTP: the Claude Code subprocess, PDF translation, code CLIs, paired devices and external clients.
2. **No second parse when the request object is available.** Pi exposes the provider request object through `onPayload`, before serialization. The binding registers that object under a per-call key, and the in-process dispatch hands it to the gateway core instead of parsing the serialized body. When the object is unavailable, the dispatch parses the body as it does today. Pi's own serialization remains, because Pi's provider SDK owns it.
3. **Validate each image once per content.** `materializeNativeFilePart` caches its decision (valid, rejected, or a padded replacement) by content hash, byte length and media type. Repeated history images then skip the base64 decode and the sharp pixel decode. The cache is bounded and holds only decisions and small padded results.
4. **The wire dialect stays the contract.** The gateway still receives the native Pi dialect and still owns provider execution. Thinking signatures, cache control, tool-call identity and retry classification therefore keep their tested path. This proposal does not add a custom in-process `streamSimple` that bypasses the dialect (see Alternatives considered).

After P3, the #24500 payload admission is re-evaluated against measurements. It stays unless the AC12 evidence shows that the concurrent working set no longer needs it.

## Alternatives considered

- Keep the #24500 bounds as the final state: rejected. Each remaining copy stays history-sized, and work per change stays O(history). The bounds only cap the multiplier, and they still allow a single oversized frame or request.
- Keep cloning in `ThreadFeed` and only make Durable incremental: rejected. Per-observer copies and full recovery snapshots would remain, and those copies are what make slow observers retain history.
- Share values without freezing: rejected. Mutation by another observer or by the publisher would become silent corruption instead of an immediate failure.
- Replace frame queues with per-observer coalescing (dirty message IDs plus an ordered fact queue) and have Durable publish upserts: deferred. Once frames share values, a pending frame costs pointers rather than history. Coalescing would also change delivery counts, completion ordering and recovery semantics that #24500 and the reply-ownership work verified.
- Externalize images inside each runtime package: rejected for P2. Packages have no host storage dependency, and their projection step is synchronous; the Main boundary covers every runtime once. Removing the adapter's remaining data-URL value needs native or adapter-level references and is left to a later proposal.
- A content-addressed blob store separate from FileManager: rejected. FileManager entries, message file refs, cleanup policy, backup and renderer resolution already exist.
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
- AC6 — Root and child agent messages, persisted rows and projection IPC carry runtime images as `fileEntryId` references rather than data URLs, for file parts and tool-output images, and identical image content maps to one entry. (verification: unit and database — projection and AgentSessionMessageService with `setupTestDatabase`; owner: P2 implementer)
- AC7 — Agent message and tool renderers display referenced images, and previously persisted messages with inline data URLs render unchanged. (verification: renderer; owner: P2 implementer)
- AC8 — Image entries referenced by a live unpersisted view survive beyond the cleanup grace period, entries become unreferenced and are cleaned up after their messages are deleted, and the role migration applies on a populated database. (verification: database and migration tests; owner: P2 implementer)
- AC9 — Native model requests are byte-identical before and after P2 for the same native history. (verification: unit — gateway binding integration fixture; owner: P2 implementer)
- AC10 — In-process native model calls open no socket, the existing gateway contracts for authentication, internal controls, usage and response-ID attribution, tracing, error envelopes, cancellation and HTTP 413 hold on the in-process path, and external callers keep HTTP. (verification: unit — gateway and binding integration tests; owner: P3 implementer)
- AC11 — A native call whose request object is available performs no gateway-side parse of the serialized body, and repeated history images skip base64 and sharp decoding after their first validation while padding results stay identical. (verification: unit — binding and fileProcessor tests; owner: P3 implementer)
- AC12 — The #24500 workload shape, one session dispatching four image-reading Durable subagents, runs 30 minutes in a development Electron build without OOM, and the report records main-process heap, external memory and model-call counts against the #24500 baseline. (verification: Electron; owner: final implementation integrator)
- AC13 — The runtime README, the observability and gateway references and this note's triplet describe the shipped delivery, reference and transport semantics, and each superseded #24500 bound is removed or justified by AC12 evidence. (verification: docs gate; owner: final implementation integrator)

## Risks

- Freezing turns in-place mutation of delivered values into runtime errors. The runtime package suites and the Main agent-session, runtime and message suites pass, but an untested consumer path could still fail; such a failure stops that observer and is reported.
- Non-plain values (dates, typed arrays, errors) cannot be frozen. They are copied once from the publisher and then shared unfrozen.
- Incremental Durable projection relies on native views reusing entry objects for an unchanged prefix. Pi Durable 1.5.2 does so; a native change that returns new objects only loses the reuse, because the identity check then rebuilds.
- P2 adds disk writes and an asynchronous step to the observation path. A FileManager failure must not drop content: the step keeps the inline value for that part and reports a diagnostic.
- P2 stores image bytes on disk twice, in the native store and in FileManager, by design: the product archive must outlive native compaction and deletion.
- The P3 in-process dispatch must reproduce the error envelopes that Elysia's error handler produces today. Any divergence changes Pi's retry classification. Anthropic `fetch` injection has no existing repository test.
- AC12 is a development-build measurement, not acceptance on a Windows packaged build. The original Windows workload remains a separate verification.
