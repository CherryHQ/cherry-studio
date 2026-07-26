# Selection Assistant History Aggregation Design

## Context

Selection actions can use a configured assistant and persist a successful temporary
conversation into that assistant's topic history. The initial implementation promotes
each successful invocation into a separate topic. Selection result windows are pooled,
so a pinned or otherwise active result window can remain visible while later invocations
open additional windows.

The desired behavior is:

1. Successful runs of the same selection action with the same configured assistant
   appear in one persistent topic.
2. Model invocations remain independent. Previously saved selection history is never
   sent as context for a later invocation.
3. A new selection invocation replaces the existing result window, including when the
   old window is pinned.

## Decisions

### Aggregate by assistant and action

The durable aggregation identity is the pair `(assistantId, actionId)`.

- The same action using the same assistant appends to one topic.
- Different actions using the same assistant use different topics.
- The same action using different assistants uses different topics.
- The aggregate topic is recreated if the user deletes it.

The topic ID is derived deterministically from a versioned namespace plus the assistant
and action IDs. This avoids adding a preference field, database column, migration, or
title-based lookup. The action's current display name is used when the topic is first
created.

### Separate generation from history storage

Every invocation continues to lease a fresh temporary topic. The AI request and
regeneration operate only on that invocation's temporary messages. The aggregate
persistent topic is a history sink and is never loaded into the generation context.

After a successful response, the temporary messages are appended atomically to the
aggregate topic. If the aggregate topic does not exist, the same transaction creates it,
its virtual root message, and the first message chain. A failed transaction restores the
temporary state so the caller can report the save failure without losing the displayed
answer.

Stopping, aborting, or failing generation does not append history. Actions without a
configured assistant, or with history saving disabled, keep the existing temporary-only
behavior.

### Reuse one selection result window

`SelectionAction` becomes a singleton window instead of a pooled multi-instance window.
Each `WindowManager.open()` call reuses that window and delivers the new invocation data.
The renderer keys the action subtree by `invocationId`, so replacement unmounts the old
invocation, stops its active stream, releases its temporary topic, and renders the new
result.

The replacement also resets invocation-specific pin and layout state. The window is
repositioned and shown using the existing selection display choreography.

## Data flow

1. `SelectionService.processAction()` creates a fresh `invocationId` and opens the
   singleton selection result window.
2. The renderer leases a fresh temporary topic and sends the composed prompt into it.
3. The model completes successfully.
4. When history saving is enabled, the renderer requests promotion with an aggregate
   target containing the configured assistant ID, action ID, and action display name.
5. `TemporaryChatService` derives the stable target topic ID and, in one write
   transaction, creates or validates the topic and appends the temporary message chain.
6. After commit, DataApi change notifications refresh topic membership for a newly
   created target and topic content for an existing target.

## Error handling

- A missing temporary topic is an error.
- An existing aggregate topic must belong to the requested assistant; a mismatch is an
  error rather than a silent cross-assistant append.
- Transaction failure restores the temporary topic and messages.
- Persistence failure is surfaced in the selection result without removing the already
  displayed model answer.
- Replacing the window aborts an in-flight generation, which therefore cannot persist.

## Compatibility

- No database schema or migration is added.
- Existing selection action preferences remain valid.
- Topics created by the earlier one-topic-per-invocation behavior are left untouched.
- The aggregation option is internal to temporary-topic promotion and does not alter
  normal topic creation.
- The history aggregation and singleton-window changes remain small, separately
  testable patch islands for future upstream rebases.

## Verification

- Two successful runs with the same assistant and action produce one topic with two
  independent user/assistant message groups.
- Different actions or assistants produce separate topics.
- A later AI request contains no messages from an earlier run.
- Deleting an aggregate topic causes the next successful run to recreate it.
- Errors, manual stops, and disabled history saving do not append.
- Repeated `processAction()` calls reuse one window and deliver fresh invocation data.
- Replacing an in-flight invocation stops its stream and cleans up its temporary topic.
