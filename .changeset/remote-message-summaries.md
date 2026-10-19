---
'@cherrystudio/remote-protocol': minor
---

Add the opt-in `agentMessageSummariesVersion: 1` capability and `agent.messages.list`
`partsMode: 'paged'` request. Summaries omit `partIds` and retain message identity,
revision and outcome metadata; clients enumerate complete parts through
`agent.parts.list`. Requests without the mode retain the full-message contract.
The list result type now includes `AgentMessageSummary`; consumers must narrow
list items before treating them as full `AgentMessage` recovery snapshots.
