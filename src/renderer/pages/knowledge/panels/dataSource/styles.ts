// The checkbox is an inline-level box, so by default it aligns to its text baseline.
// When the check indicator (an SVG) mounts on check, that baseline moves and the whole
// box nudges up/down in the row. `align-middle` aligns it by its box center instead —
// independent of the indicator — so it stays put; `inline-flex items-center justify-center`
// keeps the indicator centered within the box. Applies to both row and header checkboxes.
export const knowledgeDataSourceCheckboxClassName =
  'inline-flex items-center justify-center align-middle border-border-active text-foreground hover:bg-accent data-[state=checked]:border-border-active data-[state=checked]:bg-background-subtle data-[state=checked]:text-foreground focus-visible:ring-border-active/20'

// Shared column template for the data-source list. The header row and every data
// row use this same grid so columns stay aligned: checkbox / name (flex) / type /
// status / updated-at / actions.
export const KNOWLEDGE_ITEM_ROW_GRID = 'grid grid-cols-[2.5rem_minmax(0,1fr)_6rem_8rem_8rem_3rem] items-center gap-2'
