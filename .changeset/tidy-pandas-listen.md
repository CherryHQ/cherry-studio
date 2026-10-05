---
'@cherrystudio/remote-protocol': patch
---

Add an optional `stage` member to the failure snapshot, naming where in the request pipeline the failure happened (`transport`, `http`, `parse`, `stream`, `runtime`, `persistence`, `unknown`). Optional so already-persisted failure snapshots keep parsing.
