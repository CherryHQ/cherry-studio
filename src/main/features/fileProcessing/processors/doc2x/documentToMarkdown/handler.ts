import type { FileProcessorFeatureCapability, FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileInfo } from '@shared/types/file'

import { getRequiredApiHost, getRequiredApiKey, getRequiredCapability } from '../../../utils/provider'
import type { FileProcessingCapabilityHandler, FileProcessingRemotePollResult } from '../../types'
import type {
  Doc2xFormulaLevel,
  Doc2xParsePage,
  Doc2xTaskStage,
  PreparedDoc2xQueryContext,
  PreparedDoc2xStartContext
} from '../types'
import { createUploadTask, getExportResult, getParseStatus, triggerExportTask, uploadFile } from '../utils'

type Doc2xQueryContext = Omit<PreparedDoc2xQueryContext, 'signal'> & {
  signal?: AbortSignal
  stage?: Doc2xTaskStage
  modelVersion?: string
  formulaLevel?: Doc2xFormulaLevel
  mergeCrossPageForms?: boolean
  markdownContent?: string
}
type Doc2xCapability = Extract<FileProcessorFeatureCapability, { feature: 'document_to_markdown' }>

export const doc2xDocumentToMarkdownHandler: FileProcessingCapabilityHandler<
  'document_to_markdown',
  Doc2xQueryContext
> = {
  mode: 'remote-poll',
  prepare(file, config, signal) {
    signal?.throwIfAborted()
    const startContext = prepareStartContext(file, config, signal)

    return {
      mode: 'remote-poll',
      async startRemote(startSignal) {
        const uploadTask = await createUploadTask({
          ...startContext,
          signal: startSignal
        })

        await uploadFile(startContext.file.path, uploadTask.uploadUrl, startContext.apiHost, startSignal)

        return {
          providerTaskId: uploadTask.uid,
          status: 'processing',
          progress: 0,
          remoteContext: {
            apiHost: startContext.apiHost,
            apiKey: startContext.apiKey,
            stage: 'parsing',
            modelVersion: startContext.modelVersion,
            formulaLevel: startContext.formulaLevel,
            mergeCrossPageForms: startContext.mergeCrossPageForms
          }
        }
      },
      async pollRemote(
        task,
        pollSignal
      ): Promise<FileProcessingRemotePollResult<'document_to_markdown', Doc2xQueryContext>> {
        const context: Doc2xQueryContext = {
          apiHost: task.remoteContext.apiHost,
          apiKey: task.remoteContext.apiKey,
          signal: pollSignal,
          stage: task.remoteContext.stage,
          modelVersion: task.remoteContext.modelVersion,
          formulaLevel: task.remoteContext.formulaLevel,
          mergeCrossPageForms: task.remoteContext.mergeCrossPageForms,
          markdownContent: task.remoteContext.markdownContent
        }

        if (task.remoteContext.stage === 'parsing') {
          return handleParseStage(task.providerTaskId, task.remoteContext, context)
        }

        return handleExportStage(task.providerTaskId, context)
      },
      toPersistable(remoteContext, providerTaskId) {
        return {
          providerTaskId,
          stage: remoteContext.stage,
          apiHost: remoteContext.apiHost
        }
      },
      rehydrate(persisted, restoredConfig) {
        if (!persisted.apiHost) {
          throw new Error('doc2x rehydrate: missing apiHost in persisted remote state')
        }
        return {
          providerTaskId: persisted.providerTaskId,
          remoteContext: {
            apiHost: persisted.apiHost,
            apiKey: getRequiredApiKey(restoredConfig, 'doc2x'),
            stage: (persisted.stage ?? 'parsing') as Doc2xTaskStage,
            modelVersion: getDoc2xCapability(restoredConfig).modelId,
            formulaLevel: getDoc2xCapability(restoredConfig).formulaLevel,
            mergeCrossPageForms: getDoc2xCapability(restoredConfig).mergeCrossPageForms
          }
        }
      }
    }
  }
}

function prepareStartContext(
  file: FileInfo,
  config: FileProcessorMerged,
  signal?: AbortSignal
): PreparedDoc2xStartContext {
  signal?.throwIfAborted()

  const capability = getDoc2xCapability(config)

  return {
    apiHost: getRequiredApiHost(capability),
    apiKey: getRequiredApiKey(config, 'doc2x'),
    file,
    modelVersion: capability.modelId,
    formulaLevel: capability.formulaLevel,
    mergeCrossPageForms: capability.mergeCrossPageForms
  }
}

function getDoc2xCapability(config: FileProcessorMerged): Doc2xCapability {
  return getRequiredCapability(config, 'document_to_markdown', 'doc2x') as Doc2xCapability
}

export async function handleParseStage(
  providerTaskId: string,
  queryContext: Doc2xQueryContext,
  context: PreparedDoc2xQueryContext
): Promise<FileProcessingRemotePollResult<'document_to_markdown', Doc2xQueryContext>> {
  const payload = await getParseStatus(providerTaskId, context)

  if (payload.code !== 'success') {
    return {
      status: 'failed',
      error: payload.msg || payload.message || payload.code
    }
  }

  const parseStatus = payload.data

  if (!parseStatus) {
    throw new Error(`Doc2x parse status response is missing data for uid ${providerTaskId}`)
  }

  if (parseStatus.status === 'failed') {
    return {
      status: 'failed',
      error: parseStatus.detail || 'Doc2x markdown conversion failed'
    }
  }

  if (parseStatus.status !== 'success') {
    return {
      status: 'processing',
      progress: Math.min(98, parseStatus.progress ?? 0)
    }
  }

  const exportPayload = await triggerExportTask(providerTaskId, context, {
    modelVersion: queryContext.modelVersion,
    formulaLevel: queryContext.formulaLevel,
    mergeCrossPageForms: queryContext.mergeCrossPageForms
  })

  if (exportPayload.code !== 'success') {
    return {
      status: 'failed',
      error: exportPayload.msg || exportPayload.message || exportPayload.code
    }
  }

  const exportStatus = exportPayload.data

  if (exportStatus?.status === 'failed') {
    return {
      status: 'failed',
      error: 'Doc2x markdown export failed'
    }
  }

  const pages = parseStatus.result?.pages ?? []
  const hasStructuredLayout =
    queryContext.modelVersion === 'v3-2026' && pages.some((page) => (page.layout?.blocks.length ?? 0) > 0)

  return {
    status: 'processing',
    progress: 99,
    remoteContext: {
      ...queryContext,
      stage: 'exporting',
      ...(hasStructuredLayout ? { markdownContent: buildDoc2xMarkdown(pages) } : {})
    }
  }
}

export async function handleExportStage(
  providerTaskId: string,
  context: Doc2xQueryContext
): Promise<FileProcessingRemotePollResult<'document_to_markdown', Doc2xQueryContext>> {
  const payload = await getExportResult(providerTaskId, context)

  if (payload.code !== 'success') {
    return {
      status: 'failed',
      error: payload.msg || payload.message || payload.code
    }
  }

  const exportStatus = payload.data

  if (!exportStatus) {
    throw new Error(`Doc2x export result response is missing data for uid ${providerTaskId}`)
  }

  if (exportStatus.status === 'failed') {
    return {
      status: 'failed',
      error: 'Doc2x markdown export failed'
    }
  }

  if (exportStatus.status !== 'success' || !exportStatus.url) {
    return {
      status: 'processing',
      progress: 99
    }
  }

  return {
    status: 'completed',
    output: {
      ...(context.markdownContent !== undefined
        ? { kind: 'markdown' as const, markdownContent: context.markdownContent }
        : { kind: 'remote-zip-url' as const, downloadUrl: exportStatus.url, configuredApiHost: context.apiHost })
    }
  }
}

export function buildDoc2xMarkdown(pages: readonly Doc2xParsePage[]): string {
  return [...pages]
    .sort((a, b) => a.page_idx - b.page_idx)
    .map((page) => {
      if (!page.layout?.blocks.length) {
        return page.md ?? ''
      }

      const content = page.layout.blocks
        .filter((block) => block.attributes?.is_boilerplate !== true)
        .sort((a, b) => a.reading_order - b.reading_order)
        .map((block) => (block.type === 'Table' ? (block.table_data?.html ?? block.text) : block.text))
        .filter((value) => value.trim().length > 0)
        .join('\n\n')

      return content
    })
    .filter((page) => page.trim().length > 0)
    .join('\n\n')
}
