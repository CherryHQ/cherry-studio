/**
 * Keyword-highlight tint for notes search.
 *
 * `mark` carries no app-wide styling, so it would fall back to the browser's default
 * yellow. Tinting it here keeps the shared `HighlightText` (and every other consumer
 * of it) untouched, and keeps the row name and the match list looking the same.
 */
export const SEARCH_HIGHLIGHT_CLASS =
  '[&_mark]:rounded-xs [&_mark]:bg-primary/20 [&_mark]:px-0.5 [&_mark]:text-foreground'
