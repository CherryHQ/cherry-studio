export function isSyntheticClaudeModel(model: unknown): model is '<synthetic>' {
  return model === '<synthetic>'
}

/** Only the CLI interrupt placeholder is empty output; local command text must survive. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native history can contain arbitrary records; verify the synthetic model and every text block before discarding an interrupt placeholder.
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
