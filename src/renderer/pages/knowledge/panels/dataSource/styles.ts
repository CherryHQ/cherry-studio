// `inline-flex items-center justify-center` pins the box's display so the check
// indicator (mounted only when checked) can't shift the baseline of the otherwise
// `inline-block` button — keeping the box visually stable across unchecked/checked/
// indeterminate in both the row and header (select-all) checkboxes.
export const knowledgeDataSourceCheckboxClassName =
  'inline-flex items-center justify-center border-border-active text-foreground hover:bg-accent data-[state=checked]:border-border-active data-[state=checked]:bg-background-subtle data-[state=checked]:text-foreground focus-visible:ring-border-active/20'
