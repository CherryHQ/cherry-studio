import { extname } from 'node:path'

import type { Message, ImageContent, TextContent } from '@earendil-works/pi-ai'
import { fileTypeFromBuffer } from 'file-type'

import { application } from '@application'
import { t } from '@main/i18n'
import type { CherryMessagePart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'

import type { DeepseekMessage } from './deepseek'

export interface ImportedContent {
  parts: CherryMessagePart[]
  model: Message
}

export async function deepseekContent(
  source: DeepseekMessage,
  read: (name: string) => Promise<Buffer>,
  files: Record<string, string>,
  saveFile: (sourceId: string, entryId: string) => void
): Promise<ImportedContent> {
  const parts: CherryMessagePart[] = []
  const native: Array<TextContent | ImageContent> = []
  const sourceUrls = new Set<string>()
  const text = (value: string) => {
    parts.push({ type: 'text', text: value })
    native.push({ type: 'text', text: value })
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
        native.push({ type: 'text', text: `${t('agent_import_reasoning')}\n${part.content}` })
        break
      case 'TOOL_SEARCH':
      case 'TOOL_OPEN': {
        const results = part.type === 'TOOL_SEARCH' ? part.results : [part]
        for (const result of results) {
          if (!result.url || !URL.canParse(result.url) || !['https:', 'http:'].includes(new URL(result.url).protocol))
            continue
          if (sourceUrls.has(result.url)) continue
          sourceUrls.add(result.url)
          parts.push({
            type: 'source-url',
            sourceId: `deepseek-${source.id}-${sourceUrls.size}`,
            url: result.url,
            ...(result.title && { title: result.title })
          })
        }
        native.push({ type: 'text', text: `${t('agent_import_search')}\n${JSON.stringify(part, null, 2)}` })
        break
      }
      case 'TOOL_IMAGE_SEARCH':
        text(`${t('agent_import_search')}\n${JSON.stringify(part, null, 2)}`)
        break
      case 'FILE':
        for (const file of part.files) {
          if (file.export_path === null) {
            text(t('agent_import_missing_file', { name: file.file_name }))
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
          if (file.is_image) native.push({ type: 'image', data: bytes.toString('base64'), mimeType: mediaType })
          else
            native.push({
              type: 'text',
              text: `Attached file ${JSON.stringify(file.file_name)}: ${manager.getPhysicalPath(entryId)}`
            })
        }
    }
  }
  const timestamp = Date.parse(source.inserted_at)
  if (source.role === 'USER') return { parts, model: { role: 'user', content: native, timestamp } }
  if (native.some((part) => part.type === 'image')) throw new Error('DeepSeek assistant image messages are unsupported')
  return {
    parts,
    model: {
      role: 'assistant',
      content: native.filter((part) => part.type === 'text'),
      timestamp,
      api: 'openai-completions',
      provider: 'deepseek',
      model: 'imported-history',
      // Provider adapters discard error-stop messages; source failure remains in product history.
      stopReason: 'stop',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      }
    }
  }
}
