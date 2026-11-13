export function isSyntheticClaudeModel(model: unknown): boolean {
  return model === '<synthetic>'
}

/** Only the CLI interrupt placeholder is empty output; local command text must survive. */
export function isSyntheticTurnCloser(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const message = value as { model?: unknown; content?: unknown }
  if (!isSyntheticClaudeModel(message.model) || !Array.isArray(message.content) || !message.content.length) return false
  const text: string[] = []
  for (const block of message.content) {
    if (!block || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') return false
    text.push(block.text)
  }
  return text.join('').trim() === 'No response requested.'
}
