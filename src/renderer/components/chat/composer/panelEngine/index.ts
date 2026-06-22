/**
 * `panelEngine` is a temporary fork of `components/QuickPanel`, created so the v2
 * composer can evolve its quick-panel (inputAdapter / readOnly / keydown-dispatch
 * model in `provider`, `view`, `types`) without touching the live v1 QuickPanel.
 *
 * - `provider` / `view` / `types` intentionally diverge from v1 — fix here, not there.
 * - `defaultStrategies` / `hook` / `list` are byte-identical copies of v1 — keep them
 *   in sync; any fix must be applied to both copies until the fork collapses.
 *
 * Collapse plan: at the pages switchover (when the v1 Inputbar is deleted) this fork
 * merges back into `components/QuickPanel` and this directory is removed.
 */
export * from './defaultStrategies'
export * from './hook'
export * from './list'
export * from './provider'
export * from './types'
export * from './view'
