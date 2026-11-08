import type { FileProcessorFeatureCapability, FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileInfo } from '@shared/types/file'

import { getRequiredApiHost, getRequiredApiKey, getRequiredCapability } from '../../../utils/provider'
import type { FileProcessingCapabilityHandler, FileProcessingRemotePollResult } from '../../types'
import type {
  Doc2xFormulaLevel,
  Doc2xLayoutBlock,
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
          apiHost: remoteContext.apiHost,
          modelVersion: remoteContext.modelVersion,
          formulaLevel: remoteContext.formulaLevel,
          mergeCrossPageForms: remoteContext.mergeCrossPageForms
        }
      },
      rehydrate(persisted, restoredConfig) {
        if (!persisted.apiHost) {
          throw new Error('doc2x rehydrate: missing apiHost in persisted remote state')
        }
        const capability = getDoc2xCapability(restoredConfig)
        return {
          providerTaskId: persisted.providerTaskId,
          remoteContext: {
            apiHost: persisted.apiHost,
            apiKey: getRequiredApiKey(restoredConfig, 'doc2x'),
            stage: (persisted.stage ?? 'parsing') as Doc2xTaskStage,
            modelVersion: persisted.modelVersion ?? capability.modelId,
            formulaLevel: persisted.formulaLevel ?? capability.formulaLevel,
            mergeCrossPageForms: persisted.mergeCrossPageForms ?? capability.mergeCrossPageForms
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
    queryContext.modelVersion === 'v3-2026' &&
    (queryContext.formulaLevel ?? 0) === 0 &&
    queryContext.mergeCrossPageForms !== true &&
    pages.some((page) => (page.layout?.blocks.length ?? 0) > 0)

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
    .map(buildDoc2xPageMarkdown)
    .filter((page) => page.trim().length > 0)
    .join('\n\n')
}

function buildDoc2xPageMarkdown(page: Doc2xParsePage): string {
  const blocks = page.layout?.blocks ?? []
  if (!blocks.length) {
    return page.md ?? ''
  }

  const orderedBlocks = blocks
    .filter((block) => block.attributes?.is_boilerplate !== true)
    .sort((a, b) => a.reading_order - b.reading_order)
  const markdown = stripDoc2xBoilerplate(page.md ?? '')
  const tableHtml = orderedBlocks
    .filter((block) => block.type === 'Table' && block.table_data?.html)
    .map((block) => block.table_data?.html ?? '')

  if (markdown.trim().length > 0) {
    return tableHtml.reduce(replaceNextMarkdownTable, markdown)
  }

  return buildStructuredDoc2xMarkdown(orderedBlocks)
}

function buildStructuredDoc2xMarkdown(blocks: readonly Doc2xLayoutBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'Table') {
        return block.table_data?.html ?? block.text
      }

      if (block.type === 'Figure' && !block.text.trim() && block.src) {
        return `![](${block.src})`
      }

      return block.text
    })
    .filter((value) => value.trim().length > 0)
    .join('\n\n')
}

function stripDoc2xBoilerplate(markdown: string): string {
  return markdown
    .replace(/<!--\s*Meanless:[\s\S]*?-->/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function replaceNextMarkdownTable(markdown: string, tableHtml: string): string {
  const lines = markdown.split('\n')
  let inFence = false
  let separatorIndex = -1

  for (let index = 0; index < lines.length; index += 1) {
    if (isMarkdownFence(lines[index])) {
      inFence = !inFence
      continue
    }

    if (!inFence && index > 0 && isMarkdownTableRow(lines[index - 1]) && isMarkdownTableSeparator(lines[index])) {
      separatorIndex = index
      break
    }
  }

  if (separatorIndex === -1) {
    return `${markdown.trim()}\n\n${tableHtml}`
  }

  let start = separatorIndex - 1
  while (start > 0 && !isMarkdownFence(lines[start - 1]) && isMarkdownTableRow(lines[start - 1])) {
    start -= 1
  }

  let end = separatorIndex + 1
  while (end < lines.length && !isMarkdownFence(lines[end]) && isMarkdownTableRow(lines[end])) {
    end += 1
  }

  lines.splice(start, end - start, tableHtml)
  return lines.join('\n').trim()
}

function isMarkdownTableRow(line: string): boolean {
  const value = line.trim()
  return value.includes('|')
}

function isMarkdownFence(line: string): boolean {
  return /^\s*(```+|~~~+)/.test(line)
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))
}
