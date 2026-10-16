---
"@cherrystudio/file-preview": patch
---

Show a PowerPoint-specific fallback when a PPTX archive exceeds the previewer's ZIP safety limits. This is separate from files whose compressed source is larger than 25 MiB, and it reuses the existing external-open action.
