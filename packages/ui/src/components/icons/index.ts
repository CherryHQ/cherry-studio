/**
 * Icons 模块统一导出
 *
 * Logo icons are compound components:
 *   <Anthropic />        — Color (default)
 *   <Anthropic.Color />  — Color (explicit)
 *   <Anthropic.Mono />   — Mono (currentColor)
 */

export * from './general'
export * from './logos'
export { ColorIcon, createMonoIcon, GrayscaleIcon, MonoIcon } from './MonoIcon'
