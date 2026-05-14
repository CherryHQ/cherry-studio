/**
 * Icons 模块统一导出
 *
 * Logo icons are compound components:
 *   <Anthropic />         — auto light/dark (default, follows the `dark:` Tailwind variant)
 *   <Anthropic variant="light" /> — force light variant
 *   <Anthropic variant="dark" />  — force dark variant
 *   <Anthropic.Avatar />  — circular avatar wrapper (padded or full-bleed)
 *   Anthropic.colorPrimary — Brand color string
 */

export * from './general'
export * as ModelIcons from './models'
export { MODEL_ICON_CATALOG, type ModelIconKey } from './models/catalog'
export * from './providers'
export { PROVIDER_ICON_CATALOG, type ProviderIconKey } from './providers/catalog'
export { resolveIcon, resolveModelIcon, resolveModelToProviderIcon, resolveProviderIcon } from './registry'
export * from './types'
