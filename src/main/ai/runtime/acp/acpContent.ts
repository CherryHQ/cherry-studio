import { isUtf8 } from 'node:buffer'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  encodeAcpAttachment,
  type AcpContentBlock,
  type AcpPromptCapabilities
} from '@cherrystudio/agent-runtime-acp/v1'
import { materializeNativeFilePart } from '@main/ai/messages/fileProcessor'
import { t } from '@main/i18n'
import { parseDataUrl } from '@shared/utils/dataUrl'
import { textExts } from '@shared/utils/file'

import { withAgentContext } from '../agentUserContent'
import { inlineFileContent, localFilePath, localPartContent } from '../localContent'
import type { AgentRuntimeUserInput } from '../types'

export async function acpContent(
  input: AgentRuntimeUserInput,
  capabilities: AcpPromptCapabilities
): Promise<AcpContentBlock[]> {
  const content: AcpContentBlock[] = []
  const message = withAgentContext(input.message, input.context)
  for (const [index, part] of (message.data.parts ?? []).entries()) {
    if (part.type === 'data-knowledge-scope') continue
    if (part.type !== 'file') {
      content.push(await localPartContent(part, false))
      continue
    }
    const path = localFilePath(part)
    const unavailable = () =>
      new Error(t('agent.session.attachment.unavailable', { name: part.filename ?? part.mediaType }))
    content.push(
      await encodeAcpAttachment(
        {
          uri: path ? pathToFileURL(path).href : `urn:cherry:attachment:${index}`,
          name: part.filename ?? (path ? basename(path) : part.mediaType),
          mimeType: part.mediaType,
          inline: () => inlineFileContent(part),
          unsupported: (kind) =>
            new Error(
              kind === 'image'
                ? t('agent.session.attachment.image_unsupported')
                : t('agent.session.attachment.audio_unsupported')
            ),
          async linkedSize() {
            const metadata = path && (await stat(path).catch(() => undefined))
            if (!metadata || !metadata.isFile()) throw unavailable()
            return metadata.size
          },
          async embedded() {
            try {
              const materialized = await materializeNativeFilePart(part)
              const parsed = materialized?.url ? parseDataUrl(materialized.url) : null
              if (!parsed || !materialized) throw unavailable()
              const mimeType = materialized.mediaType
              const bytes = parsed.isBase64
                ? Buffer.from(parsed.data, 'base64')
                : Buffer.from(decodeURIComponent(parsed.data))
              const text =
                mimeType.startsWith('text/') ||
                textExts.includes((extname(part.filename ?? '') || extname(path ?? '')).toLowerCase())
              return text && isUtf8(bytes)
                ? { mimeType, text: new TextDecoder().decode(bytes) }
                : { mimeType, blob: bytes.toString('base64') }
            } catch {
              throw unavailable()
            }
          }
        },
        capabilities
      )
    )
  }
  return content
}
