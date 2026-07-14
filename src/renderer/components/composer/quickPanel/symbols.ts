/**
 * QuickPanel trigger symbols owned by the composer (the consumer) — not by the
 * generic QuickPanel component, which only knows `symbol: string`.
 *
 * Each value is the literal trigger key the composer registers/opens panels with.
 */
export const ComposerPanelSymbol = {
  Root: '/',
  KnowledgeBase: '#',
  QuickPhrases: 'quick-phrases',
  McpStatus: 'mcp-status'
} as const
