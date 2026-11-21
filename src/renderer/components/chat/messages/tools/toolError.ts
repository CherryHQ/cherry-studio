function isRecord(value: unknown): value is { text?: unknown; isError?: unknown; content?: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Error envelopes contain text strings or heterogeneous content arrays; include only nonblank string text fields in the displayed explanation.
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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Tool cards receive runtime and historical outputs without a common error schema; require isError before reading an object envelope.
export function extractToolErrorText(response: unknown): string | undefined {
  if (typeof response === 'string') return response.trim() || undefined
  if (!isRecord(response) || response.isError !== true) return undefined

  return extractTextContent(response.content)
}
