import type { ResourceLink, TextContent } from '@modelcontextprotocol/client'
import mime from 'mime/lite'

export interface ToolResultLinkData {
  url: string
  isImage: boolean
  mimeType?: string
  name?: string
}

export function getToolResultLinks(content: TextContent | ResourceLink): ToolResultLinkData[] | null {
  const text = content.type === 'text' ? content.text.trim() : content.uri
  const mimeType = content.type === 'resource_link' ? content.mimeType : undefined
  const name = content.type === 'resource_link' ? (content.title ?? content.name) : undefined
  let value: unknown = text
  if (content.type === 'text') {
    try {
      value = JSON.parse(text)
    } catch {
      // Most tools return bare URLs rather than JSON strings.
    }
  }

  const values = Array.isArray(value) ? value : [value]
  if (values.length === 0) return null

  const links: ToolResultLinkData[] = []
  for (const item of values) {
    if (typeof item !== 'string' || /\s/.test(item) || !URL.canParse(item)) return null
    const url = new URL(item)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    links.push({
      url: item,
      isImage: (mimeType ?? mime.getType(url.pathname))?.startsWith('image/') ?? false,
      mimeType,
      name
    })
  }
  return links
}
