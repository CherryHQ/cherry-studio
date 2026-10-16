---
'@cherrystudio/ui': minor
---

Add an optional `headingSlugs` prop to `Markdown` and export `normalizeHeadingText` from `rehype-heading-ids`, so a windowed markdown preview can assign document-wide heading ids — duplicate headings across separately rendered pieces keep the ids the unsplit document would give them. The document-wide numbering counts every heading a raw HTML block renders — several on one line, or one whose tag and text sit on different lines — and the reference definitions a chunk carries are rebuilt exactly as written, so the references they serve resolve instead of rendering as text.
