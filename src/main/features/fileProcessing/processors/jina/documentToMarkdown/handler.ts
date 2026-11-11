import { openAsBlob } from 'node:fs'

import { net } from 'electron'
import * as z from 'zod'

import { t } from '@main/i18n'
import { redactLiteral, redactSecretText } from '@shared/utils/redaction'

import { getRequiredApiHost, getRequiredApiKey, getRequiredCapability } from '../../../utils/provider'
import type { FileProcessingCapabilityHandler } from '../../types'

const envelopeSchema = z.object({
  code: z.number(),
  status: z.number(),
  data: z.unknown().optional(),
  message: z.unknown().optional(),
  readableMessage: z.unknown().optional()
})
const dataSchema = z.object({ content: z.string() })

function detailFromObject(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const object = value as Record<string, unknown>
  for (const key of ['message', 'readableMessage']) {
    if (typeof object[key] === 'string' && object[key].trim()) return object[key].trim()
  }
  return ''
}

function sanitizedDetails(detail: string, apiKey: string): string {
  const sanitized = redactSecretText(redactLiteral(detail, apiKey), [apiKey])
  return sanitized ? `: ${sanitized}` : ''
}

export const jinaDocumentToMarkdownHandler: FileProcessingCapabilityHandler<'document_to_markdown'> = {
  mode: 'background',
  prepare(file, config, signal) {
    signal?.throwIfAborted()
    if (!['pdf', 'docx', 'xlsx', 'pptx'].includes(file.ext?.toLowerCase() ?? '')) {
      throw new Error(t('file_processing.errors.jina_unsupported_extension'))
    }
    const capability = getRequiredCapability(config, 'document_to_markdown', 'jina')
    const apiHost = getRequiredApiHost(capability)
    const apiKey = getRequiredApiKey(config, 'jina')
    return {
      mode: 'background',
      async execute(executionContext) {
        executionContext.signal.throwIfAborted()
        executionContext.reportProgress(10)
        const blob = await openAsBlob(file.path, { type: file.mime })
        executionContext.signal.throwIfAborted()
        executionContext.reportProgress(25)
        const form = new FormData()
        form.append('file', blob, file.ext ? `${file.name}.${file.ext}` : file.name)
        const response = await net.fetch(`${apiHost}/`, {
          method: 'POST',
          body: form,
          headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
          signal: executionContext.signal,
          redirect: 'error'
        })
        const body = await response.text()
        let parsed: unknown
        let isJson = true
        try {
          parsed = JSON.parse(body)
        } catch {
          isJson = false
        }
        if (!response.ok) {
          const detail = isJson ? detailFromObject(parsed) : body.trim()
          throw new Error(
            t('file_processing.errors.jina_request_failed', {
              status: response.status,
              details: sanitizedDetails(detail, apiKey)
            })
          )
        }
        const envelope = envelopeSchema.safeParse(parsed)
        if (!isJson || !envelope.success) throw new Error(t('file_processing.errors.jina_invalid_response'))
        const { code, status, data } = envelope.data
        if (code !== 200 || status !== 20000) {
          throw new Error(
            t('file_processing.errors.jina_api_error', {
              code,
              status,
              details: sanitizedDetails(detailFromObject(envelope.data), apiKey)
            })
          )
        }
        const result = dataSchema.safeParse(data)
        if (!result.success) throw new Error(t('file_processing.errors.jina_invalid_response'))
        if (!result.data.content.trim()) throw new Error(t('file_processing.errors.jina_empty_content'))
        executionContext.reportProgress(85)
        return { kind: 'markdown', markdownContent: result.data.content }
      }
    }
  }
}
