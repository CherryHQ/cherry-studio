---
"@cherrystudio/extension-table-plus": patch
---

Clear a reused `<col>` element's stale `width` and `min-width` before applying the current column declaration in `TableView.updateColumns`. A column that lost its stored width previously kept the old `width` alongside the new `min-width`, so it stayed locked at its previous size after inserting a column or resizing. Columns narrower than `cellMinWidth` are also no longer rewritten on every update.
