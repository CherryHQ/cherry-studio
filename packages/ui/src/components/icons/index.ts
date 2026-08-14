/**
 * Icons 模块统一导出
 *
 * Provider logo icons from `@cherrystudio/ui/icons/providers` are compound components:
 *   <Anthropic />         — auto light/dark (default, follows the `dark:` Tailwind variant)
 *   <Anthropic variant="light" /> — force light variant
 *   <Anthropic variant="dark" />  — force dark variant
 *   <Anthropic.Avatar />  — circular avatar wrapper
 *   Anthropic.colorPrimary — Brand color string
 *
 * Key-based lookup is two-phase: resolve*Ref() is synchronous (meta catalogs
 * only), the component itself loads asynchronously via useIcon().
 * Ordinary rendering loads one implementation by key; the provider bulk catalog
 * is exposed only for consumers that intentionally render the complete set.
 */

export * from './general'
// Provider components live behind the explicit `@cherrystudio/ui/icons/providers`
// entry. Re-exporting that barrel here would evaluate every provider icon when
// ordinary key-based consumers import useIcon.
// Deliberately minimal async surface: per-icon loading goes through useIcon;
// direct loaders and the model meta catalog stay package-internal until a real
// consumer shows up.
export { loadProviderIconCatalog } from './loader'
export type { ModelIconKey } from './models/meta-catalog'
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
