---
'CherryStudio': patch
---

Agent sessions no longer block the next user message on detached background work (background subagents / commands). A turn settles when its own generation ends; the still-running work keeps the connection occupied and the session status "active", its results are delivered by the runtime's receive-only wake, and a queued follow-up starts immediately — admitted with a system-reminder listing the pending tasks so the model does not re-launch duplicate work. This refines #20922: "one reply per input" is now preserved by task attribution and status rather than by holding the reply open.
