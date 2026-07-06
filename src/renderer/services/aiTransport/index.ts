// Public API of the renderer-side AI-streaming runtime. Consumers import from
// this barrel; the directory's other files are internal. See
// docs/references/renderer-architecture.md §5.
export { ipcChatTransport } from './IpcChatTransport'
export { type ExecutionTerminal, TopicStreamSubscription } from './TopicStreamSubscription'
