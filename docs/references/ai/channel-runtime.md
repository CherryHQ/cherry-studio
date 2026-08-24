---
description: IM channel connection, ingress, live-update, terminal-delivery, block, and epoch ownership beneath Conversation runtime
sources:
  - src/main/ai/channels
  - src/main/ai/streamManager/listeners/ChannelAdapterListener.ts
---

# Channel runtime

Channel input and generated-result delivery are separate lifecycles. Neither is
a Conversation control owner: inbound messages submit typed Conversation input,
while outbound listeners consume committed execution output.

## Owners

| Owner | Authority |
|---|---|
| `ChannelIngressService` | lifecycle ordering for adapter startup, intake pause, and inbound drain |
| `ChannelManager` | adapter pool, successful connection identity, and monotonically increasing connection epoch |
| `ChannelDeliveryService` | generated-result live ownership, blocked-channel policy, terminal FIFO/dedupe, bounded send, and shutdown drain |
| `ChannelAdapterListener` | per-execution accumulated text and one terminal-delivery submission |
| `ChannelAdapter` | platform card/message implementation and platform-specific throttling |

`ChannelDeliveryService.connectionEpochs` is a consumed stale fence. Only
`ChannelManager` generates an epoch and binds it to the adapter that actually
connected. Delivery resolves the adapter at send time through
`resolveConnectedAdapter(channelId)`. A running terminal attempt retains the
exact adapter/epoch only as its ownership fence; listeners and queued requests
never retain an adapter instance.

## Inbound path

```text
platform adapter
→ ChannelMessageHandler batching / validation
→ durable Agent input
→ ConversationRuntimeService admission
```

`ChannelIngressService` starts adapters only after their AI and Agent resource
dependencies are ready. During pause or shutdown it closes intake and drains
already-admitted batches before adapter teardown.

## Outbound path

```text
Conversation execution chunk
→ ChannelAdapterListener accumulated text
→ ChannelDeliveryService.updateLive

durable Conversation terminal
→ ChannelAdapterListener.enqueueTerminal
→ per-(channel, chat) FIFO
→ adapter resolved for the current connection epoch
```

Live updates are best effort and never retried. Disconnect, replacement, block,
or delivery shutdown aborts the old epoch's live `AbortController`.

Terminal requests are deduplicated and serialized independently per channel
chat. Each send has a 15-second ownership timeout. A timeout may already have
reached the platform, so delivery does not retry; it blocks that channel, drops
its queued work, and suppresses later live updates. Only a newer successful
`ChannelManager` connection epoch reopens it.

Planned replacement freezes new admission and drains attempts already owned by
the old epoch before disconnecting it. Unexpected connection loss aborts old
live and terminal ownership immediately. Before every platform call, Delivery
revalidates the exact adapter/epoch. `onStreamComplete` reports `Delivered` or
`NotHandled`: only an explicit `NotHandled` with no later external call may be
continued on a newer epoch. A throw, abort, or timeout after an external call
has an unknown result and is never retried, preserving at-most-once delivery.

## Conversation boundary

- Channel input carries explicit provenance into the Conversation admission
  lane; channel connection or listener liveness never decides turn admission.
- Normal terminal output is offered to delivery only after durable Conversation
  persistence.
- A deferred-recovery terminal produces an aggregate terminal effect with
  `InternalOnly` audience. No Channel delivery effect is created, so listeners
  do not need to infer or filter durability.
- Channel delivery drain is independent from Conversation quiescence; shutdown
  orders producers, delivery, and adapter teardown through lifecycle services.

## Invariants

- One epoch authority: `ChannelManager`.
- One generated-result delivery owner: `ChannelDeliveryService`.
- A listener owns text, not an adapter or connection lifecycle.
- Live delivery has no retry; terminal delivery has no retry after timeout.
- Cross-epoch terminal continuation is allowed only after an explicit
  `NotHandled` result; unknown external outcomes are never retried.
- Platform adapters do not decide block policy, epoch, admission, or listener
  liveness.

## Related references

- [Conversation Runtime](./conversation-runtime.md)
- [Execution Resources](./stream-manager.md)
- [Service Lifecycle](../lifecycle/README.md)
