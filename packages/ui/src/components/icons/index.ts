/**
 * Icons 模块统一导出
 *
 * Logo icons are compound components:
 *   <Anthropic />         — auto light/dark (default, follows the `dark:` Tailwind variant)
 *   <Anthropic variant="light" /> — force light variant
 *   <Anthropic variant="dark" />  — force dark variant
 *   <Anthropic.Avatar />  — circular avatar wrapper
 *   Anthropic.colorPrimary — Brand color string
 *
 * Key-based lookup is two-phase: resolve*Ref() is synchronous (meta catalogs
 * only), the component itself loads asynchronously via useIcon().
 * The full component catalogs are async chunks — never re-export them here.
 */

export * from './general'
// `ClaudeCode` exists in both ./general and ./providers barrels; the explicit
// re-export pins the general variant (matching pre-S6a behavior) — star-export
// ambiguity would otherwise drop the name entirely.
export { ClaudeCode } from './general'
// Deliberately minimal async surface: per-icon loading goes through useIcon;
// loadIcon/loadModelIcon/loadProviderIcon and the model meta catalog stay
// package-internal until a real consumer shows up.
export { loadProviderIconCatalog } from './loader'
export type { ModelIconKey } from './models/meta-catalog'
export * from './providers'
export { PROVIDER_ICON_META_CATALOG, type ProviderIconKey } from './providers/meta-catalog'
export {
  type IconRef,
  modelIconRef,
  providerIconRef,
  resolveIconRef,
  resolveModelIconRef,
  resolveModelToProviderIconRef,
  resolveProviderIconRef
} from './registry'
export * from './types'
export { useIcon } from './use-icon'
