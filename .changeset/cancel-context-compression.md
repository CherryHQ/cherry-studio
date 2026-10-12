---
'@cherrystudio/ai-core': patch
---

Allow compaction and summarization requests to share their owning turn's abort signal so cancelling a chat turn also cancels its pending compression request.
