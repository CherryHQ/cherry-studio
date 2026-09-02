/**
 * Off-chat markdown rendering: `<StaticMarkdown>` renders prompt previews, agent tool
 * output and Markdown file previews through `@cherrystudio/ui`'s `<Markdown>` with the
 * full plugin preset and Cherry Studio's code, table, link and media renderers. Hosts may
 * inject surface-specific behavior such as opening local file links.
 */

export { MarkdownHostProvider } from './MarkdownHostProvider'
export { MarkdownImageRenderer, scrollToMarkdownAnchor, shouldShowMarkdownLinkFavicon } from './MarkdownRenderers'
export { remarkLatexMath } from './remarkLatexMath'
export { StaticMarkdown } from './StaticMarkdown'
