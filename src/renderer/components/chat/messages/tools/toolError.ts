function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractTextContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content.trim() || undefined
  if (!Array.isArray(content)) return undefined

  const text = content
    .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : undefined))
    .filter((item): item is string => Boolean(item?.trim()))
    .join('\n')
    .trim()

  return text || undefined
}

export function extractToolErrorText(response: unknown): string | undefined {
  if (typeof response === 'string') return response.trim() || undefined
  if (!isRecord(response) || response.isError !== true) return undefined

  return extractTextContent(response.content)
}
