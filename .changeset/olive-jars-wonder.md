---
'@cherrystudio/remote-protocol': patch
---

Add `resource_exhausted` to the failure reason enum, so a file-descriptor or other local resource failure can be classified as such instead of falling through as `unknown`.
