---
'@cherrystudio/remote-protocol': minor
---

Add stable read-only Agent Task contracts for task discovery, configuration, execution history and revision-bound prompt content. Lists include schedule triggers and business update timestamps; runs include bounded display summaries. Tasks use the existing Agent authorization and expose persisted execution facts and readable result-session locations without adding capability flags or task storage.

Add an optional taskId filter to agent.sessions.list so task conversations remain discoverable after execution history is collected, with existing visibility and pagination rules.
