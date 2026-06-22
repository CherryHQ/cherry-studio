/**
 * `panelEngine` is a temporary fork of `components/QuickPanel`, created so the v2
 * composer can evolve its quick-panel (inputAdapter / readOnly / keydown-dispatch
 * model in `provider`, `view`, `types`) without touching the live v1 QuickPanel.
 *
 * - `provider` / `view` / `types` intentionally diverge from v1 — fix here, not there.
 * - `defaultStrategies` is the ONLY byte-identical copy of v1 — keep the two in sync until
 *   collapse. `hook` diverges (adds `useOptionalQuickPanel`); `list` / `heights` were newly
 *   extracted from the forked `view` and have no v1 twin.
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
