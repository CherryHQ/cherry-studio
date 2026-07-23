/**
 * Shared markdown rendering: the app's rich Streamdown component set, reused by
 * chat messages and every off-chat preview. Domain-neutral — chat integrations
 * (code-save, table export, citation open, inline file paths) are injected via
 * `@renderer/hooks/useMarkdownHost`, never imported here.
 */

export { default as Link } from './Link'
export { StaticMarkdown } from './StaticMarkdown'
export { useMarkdownComponents } from './useMarkdownComponents'
