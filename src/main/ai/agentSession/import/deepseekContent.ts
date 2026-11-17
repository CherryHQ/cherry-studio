import { extname } from 'node:path'

import { fileTypeFromBuffer } from 'file-type'
import { v7 as uuid } from 'uuid'

import { application } from '@application'
import { t } from '@main/i18n'
import type { CherryMessagePart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'

import type { DeepseekMessage } from './deepseek'

export interface ImportedContent {
  parts: CherryMessagePart[]
}

export async function deepseekContent(
  source: DeepseekMessage,
  read: (name: string) => Promise<Buffer>,
  files: Record<string, string>,
  saveFile: (sourceId: string, entryId: string) => void
): Promise<ImportedContent> {
  const parts: CherryMessagePart[] = []
  const text = (value: string) => {
    parts.push({ type: 'text', text: value })
  }
  for (const part of source.fragments) {
    switch (part.type) {
      case 'REQUEST':
      case 'RESPONSE':
      case 'TEMPLATE_RESPONSE':
      case 'CONTENT_RISK':
        text(part.content)
        break
      case 'THINK':
        parts.push(
          withCherryMeta(
            { type: 'reasoning', text: part.content, state: 'done' },
            { ...(part.elapsed_secs != null && { thinkingMs: part.elapsed_secs * 1000 }) }
          )
        )
        break
      case 'TOOL_SEARCH':
      case 'TOOL_OPEN':
      case 'TOOL_IMAGE_SEARCH':
        parts.push({
          type: 'dynamic-tool',
          toolCallId: uuid(),
          toolName:
            part.type === 'TOOL_SEARCH'
              ? 'deepseek_search'
              : part.type === 'TOOL_OPEN'
                ? 'deepseek_open'
                : 'deepseek_image_search',
          state: 'output-available',
          input:
            part.type === 'TOOL_SEARCH'
              ? { queries: part.queries }
              : part.type === 'TOOL_OPEN'
                ? { url: part.url }
                : {},
          output: part,
          callProviderMetadata: { cherry: { tool: { type: 'provider' } } }
        })
        break
      case 'FILE':
        for (const file of part.files) {
          if (file.export_path === null) {
            text(t('agent.import.missing_file', { name: file.file_name }))
            continue
          }
          const bytes = await read(file.export_path)
          const mediaType = (await fileTypeFromBuffer(bytes))?.mime ?? 'application/octet-stream'
          if (file.is_image && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType))
            throw new Error('Unsupported DeepSeek image')
          const manager = application.get('FileManager')
          let entryId = Object.hasOwn(files, file.id) ? files[file.id] : undefined
          if (!entryId) {
            const ext = extname(file.file_name).slice(1)
            const entry = await manager.createInternalEntry({
              source: 'bytes',
              data: bytes,
              name: file.file_name.replace(/[\\/]/g, '_'),
              ext: ext || null,
              cleanupPolicy: 'manual'
            })
            entryId = entry.id
            saveFile(file.id, entryId)
          }
          const url = manager.getUrl(entryId)
          parts.push(
            withCherryMeta({ type: 'file', url, filename: file.file_name, mediaType }, { fileEntryId: entryId })
          )
        }
    }
  }
  return { parts }
}
