import fs from 'node:fs/promises'

import type { JobStatus } from '@paddleocr/api-sdk'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileInfo } from '@shared/file/types'

import { getRequiredApiHost, getRequiredApiKey, getRequiredCapability } from '../../../utils/provider'
import type { FileProcessingCapabilityHandler, FileProcessingRemotePollResult } from '../../types'
import { createPaddleClient, PADDLE_MAX_FILE_SIZE } from '../client'

/** API host and key used to authenticate PaddleOCR requests. */
type PaddleQueryContext = {
  apiHost: string
  apiKey: string
}

/** Capability handler that converts documents to Markdown via PaddleOCR remote-poll. */
export const paddleDocumentToMarkdownHandler: FileProcessingCapabilityHandler<
  'document_to_markdown',
  PaddleQueryContext
> = {
  mode: 'remote-poll',
  /** Submits the document for parsing and sets up polling and rehydration. */
  async prepare(file, config, signal) {
    signal?.throwIfAborted()
    const { apiHost, apiKey, model } = prepareContext(file, config, signal)

    return {
      mode: 'remote-poll',
      async startRemote(startSignal) {
        const stat = await fs.stat(file.path)
        if (stat.size >= PADDLE_MAX_FILE_SIZE) {
          throw new Error('PaddleOCR file is too large (must be smaller than 50MB)')
        }
        const client = await createPaddleClient(apiHost, apiKey)
        const job = await client.submitDocumentParsing({ filePath: file.path, model }, { signal: startSignal })
        return {
          providerTaskId: job.jobId,
          status: 'pending',
          progress: 0,
          remoteContext: { apiHost, apiKey }
        }
      },
      async pollRemote(task, pollSignal) {
        return buildPollResult(task.providerTaskId, task.remoteContext, pollSignal)
      },
      toPersistable(remoteContext, providerTaskId) {
        return { providerTaskId, apiHost: remoteContext.apiHost }
      },
      rehydrate(persisted, restoredConfig) {
        if (!persisted.apiHost) {
          throw new Error('paddleocr rehydrate: missing apiHost in persisted remote state')
        }
        return {
          providerTaskId: persisted.providerTaskId,
          remoteContext: {
            apiHost: persisted.apiHost,
            apiKey: getRequiredApiKey(restoredConfig, 'paddleocr')
          }
        }
      }
    }
  }
}

/** Extracts API credentials and model from config for document parsing. */
function prepareContext(_file: FileInfo, config: FileProcessorMerged, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const capability = getRequiredCapability(config, 'document_to_markdown', 'paddleocr')
  return {
    apiHost: getRequiredApiHost(capability),
    apiKey: getRequiredApiKey(config, 'paddleocr'),
    model: capability.modelId?.trim() || undefined
  }
}

/** Maps a JobStatus to a 0–99 progress percentage. */
function mapProgress(status: JobStatus): number {
  const p = status.progress
  if (!p?.totalPages) return 0
  return Math.min(99, Math.round((p.extractedPages / p.totalPages) * 100))
}

/** Polls the PaddleOCR job and returns a structured poll result. */
export async function buildPollResult(
  providerTaskId: string,
  remoteContext: PaddleQueryContext,
  signal?: AbortSignal
): Promise<FileProcessingRemotePollResult<'document_to_markdown', PaddleQueryContext>> {
  const client = await createPaddleClient(remoteContext.apiHost, remoteContext.apiKey)
  const status = await client.getStatus(providerTaskId, { signal })

  if (status.state === 'failed') {
    return { status: 'failed', error: status.errorMsg || 'PaddleOCR markdown conversion failed' }
  }

  if (status.state === 'done') {
    const result = await client.waitDocumentParsingResult(providerTaskId, { signal })
    const markdownContent = result.pages
      .map((p) => p.markdownText)
      .join('\n\n')
      .trim()

    if (!markdownContent) {
      return {
        status: 'failed',
        error: `PaddleOCR task ${providerTaskId} completed but returned empty markdown content`
      }
    }

    return { status: 'completed', output: { kind: 'markdown', markdownContent } }
  }

  return {
    status: status.state === 'pending' ? 'pending' : 'processing',
    progress: mapProgress(status)
  }
}
