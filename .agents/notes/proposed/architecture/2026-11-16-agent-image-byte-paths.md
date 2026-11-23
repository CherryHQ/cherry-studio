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

Image bytes should cost O(1) per image in the host, not O(history × changes × observers × calls). The model must see the same content: no history truncation and no resubmitted work. P1 and P3 ship as independent stacked layers, and each is useful on its own. P2 moves to its own proposal.

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

### P2 — Moved to a separate proposal

The product reply row stores one `parts` array as JSON, and native sources map into it by offset and count. That unit forces Main to keep reply bodies resident to rebuild rows, to deep-compare whole messages to find changes, to resend whole messages over projection IPC, and to keep observation frames in memory because no durable sequenced event exists to recover from. Fixing it means storing tool calls and other items as records addressed by ID and recovering from a sequenced event log. That is a schema and protocol change with data migration, so it gets its own proposal. Keeping only an index in the root projection and converting images into file references both work around the same unit, and this proposal does not pursue them.

### P3 — Validate each history image once

Each native Pi model call passes through the internal gateway, where `prepareChatMessages` base64-decodes every history image that lacks a `fileEntryId` and runs a strict sharp pixel decode on it (`materializeNativeFilePart` in [fileProcessor](../../../../src/main/ai/messages/fileProcessor.ts)). The decision depends only on the image content and media type, yet it repeats on every call.

- `materializeNativeFilePart` caches its decision by a content digest and the media type: valid, rejected, or the padded replacement.
- A repeated image then skips the base64 decode and the sharp decode. Hashing the payload is the only remaining per-call cost.
- The cache is bounded, holds no image payloads except small padded results, and changes no decision.

The #24500 payload admission stays.

## Alternatives considered

- Keep the #24500 bounds as the final state: rejected. Each remaining copy stays history-sized, and work per change stays O(history). The bounds only cap the multiplier, and they still allow a single oversized frame or request.
- Keep cloning in `ThreadFeed` and only make Durable incremental: rejected. Per-observer copies and full recovery snapshots would remain, and those copies are what make slow observers retain history.
- Share values without freezing: rejected. Mutation by another observer or by the publisher would become silent corruption instead of an immediate failure.
- Replace frame queues with per-observer coalescing (dirty message IDs plus an ordered fact queue) and have Durable publish upserts: deferred. Once frames share values, a pending frame costs pointers rather than history. Coalescing would also change delivery counts, completion ordering and recovery semantics that #24500 and the reply-ownership work verified.
- Prune or downscale historical images: rejected, because it changes the context the model sees.
- Provider file APIs (Anthropic, OpenAI or Gemini file IDs) for history images: deferred. They would shrink requests further, but they depend on provider support and need a product decision on upload lifecycle and privacy.
- A custom Pi `streamSimple` that converts Pi context directly to Cherry messages: rejected for now. It removes the most copies, but it brings back a bespoke in-process model protocol of the kind the [harness boundaries](2026-10-17-agent-harness-boundaries.md) decision removed. It would also have to reimplement thinking replay, tool pairing, cache control and retry error shapes.
- Move native runtimes into a utility process: deferred. It limits the blast radius of an OOM but does not reduce the copies. After P1, observation traffic is small enough to make this cheaper to evaluate.
- Dispatch native model calls to the gateway in process instead of over a loopback socket, and hand the gateway Pi's request object instead of reparsing the body: deferred. The copies they remove are freed after each call and only raise peak memory when several subagents call at once, while an in-process path must reproduce the gateway's authentication, error envelopes and cancellation exactly. Revisit if AC7 shows that request-path peak memory still matters.

## Acceptance criteria

- AC1 — ThreadFeed stores and delivers one frozen copy of each published value: every observer receives the same objects, mutating a delivered or stored value throws without affecting other observers, and a publisher's later edits do not change published values. (verification: unit — `packages/agent-runtime` observation and immutable tests; owner: P1 implementer)
- AC2 — A stalled observer's pending frames share history: 90 republished snapshots of a 2,000-message history retain under 16 MiB and are all delivered, two pending terminal frames that share a 9 MiB image keep the observation open, and count-based overflow, `source-lost` and baseline-first ordering are retained. (verification: unit with heap measurement; owner: P1 implementer)
- AC3 — Durable projects each committed entry once per native window: unchanged messages keep their identity across views, a later tool result or live progress copies only the affected message without changing earlier snapshots or the committed layer, and a view that does not extend the previous entries rebuilds. (verification: unit — Durable projection with native view shapes; owner: P1 implementer)
- AC4 — Observation events, ordering, completion capture, recovery and reply ownership are unchanged: the existing runtime package suites and the Main agent-session, runtime and message suites pass. (verification: unit — package suites and scoped Main tests; owner: P1 implementer)
- AC5 — Main projections reuse the previous view of an unchanged source without decorating it again, and explicit invalidation still re-decorates. A stalled Claude observer holding 90 critical frames over 2,000 native messages retains under 16 MiB, and a Pi native fact mutated after emission is projected as emitted. (verification: unit — ThreadMessageProjection, Claude observation, Pi runtime projection; owner: P1 implementer)
- AC6 — A history image repeated across native model calls is base64- and sharp-decoded only on its first validation; valid, rejected and padded results stay identical to an uncached validation, and the cache stays bounded. (verification: unit — fileProcessor tests; owner: P3 implementer)
- AC7 — The #24500 workload shape, one session dispatching four image-reading Durable subagents, runs 30 minutes in a development Electron build without OOM, and the report records main-process heap, external memory and model-call counts against the #24500 baseline. (verification: Electron; owner: final implementation integrator)
- AC8 — The runtime README, the observability and gateway references and this note's triplet describe the shipped delivery and validation semantics, and each superseded #24500 bound is removed or justified by AC7 evidence. (verification: docs gate; owner: final implementation integrator)

## Risks

- Freezing turns in-place mutation of delivered values into runtime errors. The runtime package suites and the Main agent-session, runtime and message suites pass, but an untested consumer path could still fail; such a failure stops that observer and is reported.
- Non-plain values (dates, typed arrays, errors) cannot be frozen. They are copied once from the publisher and then shared unfrozen.
- Incremental Durable projection relies on native views reusing entry objects for an unchanged prefix. Pi Durable 1.5.2 does so; a native change that returns new objects only loses the reuse, because the identity check then rebuilds.
- AC7 is a development-build measurement, not acceptance on a Windows packaged build. The original Windows workload remains a separate verification.
- The validation cache trusts its digest: a collision would reuse another image's decision. A cryptographic digest makes that impractical.
