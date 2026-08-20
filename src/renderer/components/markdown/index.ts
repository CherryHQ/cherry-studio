/**
 * Off-chat markdown rendering: `<StaticMarkdown>` renders release notes, the update
 * dialog, prompt previews and agent tool output through `@cherrystudio/ui`'s `<Markdown>`
 * with the full plugin preset and Cherry Studio's code, table, link and media renderers.
 * Hosts may inject surface-specific behavior such as opening local file links.
 */

export { MarkdownHostProvider } from './MarkdownHostProvider'
export { StaticMarkdown } from './StaticMarkdown'
