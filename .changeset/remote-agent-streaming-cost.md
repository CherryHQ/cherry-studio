---
'@cherrystudio/remote-protocol': minor
---

Cache validated streaming text byte lengths so append offset checks encode only the new text after the first append, and export `textByteLength` so producers compute append offsets from the same cache. Keep wire fields, offset validation, atomic recovery, and completion digest checks unchanged.
