/**
 * Off-chat markdown rendering: `<StaticMarkdown>` renders release notes, the update
 * dialog, prompt previews and agent tool output through `@cherrystudio/ui`'s `<Markdown>`
 * with the full plugin preset. Chat messages render via `ChatMarkdown`, which owns the
 * rich, message-context-bound component overrides (code-save, tables, citations, file
 * links) under `components/chat/messages/markdown/`.
 */

export { StaticMarkdown } from './StaticMarkdown'
