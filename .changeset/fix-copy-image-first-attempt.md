---
'@cherrystudio/ai-core': patch
---

Fix 'Copy as Image' and 'Export Image' failing on first attempt:

- Add double requestAnimationFrame wait after style modifications in captureScrollable()
- Ensures browser completes reflow and repaint before capturing element
- Fixes issue where first click would capture collapsed element state
- No performance impact (~16-32ms delay, imperceptible to users)
