/**
 * Icons 模块统一导出
 *
 * Logo icons are compound components:
 *   <Anthropic />        — Color (default)
 *   <Anthropic.Color />  — Color (explicit)
 *   <Anthropic.Mono />   — Mono (currentColor)
 *   Anthropic.colorPrimary — Brand color string
 */

export * from './general'
export * as ModelIcons from './models'
export { MODEL_ICON_CATALOG } from './models/catalog'
export * from './providers'
export { PROVIDER_ICON_CATALOG } from './providers/catalog'
export { resolveIcon, resolveModelIcon, resolveModelToProviderIcon, resolveProviderIcon } from './registry'
export * from './types'
