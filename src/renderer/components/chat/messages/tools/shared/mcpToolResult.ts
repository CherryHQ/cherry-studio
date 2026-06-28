type UnknownRecord = Record<string, unknown>

export type McpToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string } }
  | { type: 'audio' }
  | { type: 'resource_link' }

const isRecord = (value: unknown): value is UnknownRecord => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const parseContentItem = (value: unknown): McpToolResultContent | null => {
  if (!isRecord(value)) return null

  switch (value.type) {
    case 'text':
      return typeof value.text === 'string' ? { type: 'text', text: value.text } : null
    case 'image':
      return typeof value.data === 'string' && typeof value.mimeType === 'string'
        ? { type: 'image', data: value.data, mimeType: value.mimeType }
        : null
    case 'resource': {
      const resource = value.resource
      if (!isRecord(resource)) return null
      return typeof resource.uri === 'string' &&
        (typeof resource.text === 'string' || typeof resource.blob === 'string')
        ? { type: 'resource', resource: { uri: resource.uri } }
        : null
    }
    case 'audio':
      return typeof value.data === 'string' && typeof value.mimeType === 'string' ? { type: 'audio' } : null
    case 'resource_link':
      return typeof value.uri === 'string' && typeof value.name === 'string' ? { type: 'resource_link' } : null
    default:
      return null
  }
}

export const parseMcpToolResultContent = (value: unknown): McpToolResultContent[] | null => {
  if (!isRecord(value) || !Array.isArray(value.content)) return null

  const content: McpToolResultContent[] = []
  for (const item of value.content) {
    const parsedItem = parseContentItem(item)
    if (!parsedItem) return null
    content.push(parsedItem)
  }
  return content
}
