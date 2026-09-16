# Channel Cancellation and Agent Session Archive Errors

## Goal

Finish the existing archive-versus-delete fixes without adding another lifecycle mechanism:

- A Channel connection that is superseded or stopped must settle promptly and must not create a transport after cancellation.
- An Agent Session archive rejected because generation is still active must cross IpcApi as an expected, branchable error and render localized guidance.

## Channel cancellation

`ChannelAdapter.performConnect(signal)` remains the single cancellation contract. QQ, Slack, and Discord will pass that signal to startup `net.fetch` calls and re-check cancellation after awaited startup steps before constructing a WebSocket. Existing manager ownership quarantine and pending-connection tracking remain unchanged.

This is preferred over racing promises in `ChannelManager` or dropping `pendingConnections` during shutdown: either alternative would let the underlying startup continue and potentially create a transport after ownership has ended.

Focused adapter tests will prove that aborting a stalled startup request settles `connect()` and does not construct a WebSocket. The existing ChannelManager test continues to prove that stop can acquire the transition lock and quarantine the old ownership.

## Agent Session archive error

`AgentSessionArchiveBusyError` remains an internal domain error carrying the busy session IDs. The AI IPC handler will translate it to a new `AI_AGENT_SESSION_ARCHIVE_BUSY` code for every soft-archive entry point: deleting sessions, clearing an Agent's sessions, and deleting an Agent together with its sessions.

The renderer error formatter will recognize that code and reuse `recycle_bin.move.blocked_generation`, matching the existing Topic archive behavior. The internal English error message and session IDs remain diagnostic transport data and are not shown to users.

Focused main-handler and renderer formatter tests will prove the transport code and localized output.

## Verification

Run the affected adapter, ChannelManager, AI handler, renderer error, and Agent Session delivery tests first. Then run `pnpm lint`; no schema, migration, or persisted-state checks are required because this change only tightens an existing IpcApi error contract and connection cancellation behavior.
