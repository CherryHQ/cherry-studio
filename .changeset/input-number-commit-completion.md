---
'@cherrystudio/ui': major
---

Require InputNumber and InputGroupInputNumber async onBlur handlers to return Promise<void>. Handlers that previously returned a data-bearing promise should await that operation inside an async handler without returning its data. The field still waits for completion, retains the settled draft while busy, and releases it on either success or rejection.
