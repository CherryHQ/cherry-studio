import type { ContentBlock, PromptCapabilities } from '@agentclientprotocol/sdk'

export type AcpAttachmentSource = {
  uri: string
  name: string
  mimeType: string
  inline(): Promise<{ mimeType: string; data: string }>
  embedded(): Promise<{ mimeType: string } & ({ text: string } | { blob: string })>
  linkedSize(): Promise<number>
  unsupported(kind: 'image' | 'audio'): Error
}

export async function encodeAcpAttachment(
  file: AcpAttachmentSource,
  capabilities: PromptCapabilities
): Promise<ContentBlock> {
  const kind = file.mimeType.startsWith('image/') ? 'image' : file.mimeType.startsWith('audio/') ? 'audio' : undefined
  if (kind) {
    if (!capabilities[kind]) throw file.unsupported(kind)
    return { type: kind, ...(await file.inline()) }
  }
  if (capabilities.embeddedContext) return { type: 'resource', resource: { uri: file.uri, ...(await file.embedded()) } }
  return {
    type: 'resource_link',
    uri: file.uri,
    name: file.name,
    mimeType: file.mimeType,
    size: await file.linkedSize()
  }
}
