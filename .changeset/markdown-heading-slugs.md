---
'@cherrystudio/ui': minor
---

Add an optional `headingSlugs` prop to `Markdown` and export `normalizeHeadingText` from `rehype-heading-ids`, so a windowed markdown preview can assign document-wide heading ids — duplicate headings across separately rendered pieces keep the ids the unsplit document would give them.
