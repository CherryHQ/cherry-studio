import { Button, RowFlex } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import {
  extractText,
  pollMarkdownConversionTask,
  startMarkdownConversionTask
} from '@renderer/services/fileProcessing/FileProcessingService'
import type { FileMetadata } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils/error'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import { Alert, Empty } from 'antd'
import { FileUp, Play, RefreshCw } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingSubtitle,
  SettingTitle
} from '..'

const logger = loggerService.withContext('FileProcessingTestPanel')

type ExtractResultItem = {
  processorId: FileProcessorId
  status: 'idle' | 'running' | 'completed' | 'failed'
  text?: string
  error?: string
}

type MarkdownResultItem = {
  processorId: FileProcessorId
  status: 'idle' | 'starting' | 'pending' | 'processing' | 'completed' | 'failed'
  progress?: number
  providerTaskId?: string
  markdownPath?: string
  error?: string
}

const IMAGE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff'] }]
const DOCUMENT_FILTERS = [
  { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md'] }
]

const STATUS_KEY_MAP = {
  completed: 'settings.tool.preprocess.test_panel.status.completed',
  failed: 'settings.tool.preprocess.test_panel.status.failed',
  idle: 'settings.tool.preprocess.test_panel.status.idle',
  pending: 'settings.tool.preprocess.test_panel.status.pending',
  processing: 'settings.tool.preprocess.test_panel.status.processing',
  running: 'settings.tool.preprocess.test_panel.status.running',
  starting: 'settings.tool.preprocess.test_panel.status.starting'
} as const

function supportsExtractText(processor: FileProcessorMerged): boolean {
  return processor.capabilities.some(
    (capability) => capability.feature === 'text_extraction' && capability.inputs.includes('image')
  )
}

function supportsMarkdownConversion(processor: FileProcessorMerged): boolean {
  return processor.capabilities.some((capability) => capability.feature === 'markdown_conversion')
}

const FileProcessingTestPanel: FC = () => {
  const { t } = useTranslation()
  const { data: processors, isLoading, error } = useQuery('/file-processing/processors')
  const [imageFile, setImageFile] = useState<FileMetadata | null>(null)
  const [documentFile, setDocumentFile] = useState<FileMetadata | null>(null)
  const [extractResults, setExtractResults] = useState<Record<string, ExtractResultItem>>({})
  const [markdownResults, setMarkdownResults] = useState<Record<string, MarkdownResultItem>>({})
  const [isRunningExtract, setIsRunningExtract] = useState(false)
  const [isRunningMarkdown, setIsRunningMarkdown] = useState(false)

  const extractProcessors = (processors ?? []).filter(supportsExtractText)
  const markdownProcessors = (processors ?? []).filter(supportsMarkdownConversion)

  const updateExtractResult = (processorId: FileProcessorId, next: Partial<ExtractResultItem>) => {
    setExtractResults((current) => ({
      ...current,
      [processorId]: {
        ...current[processorId],
        processorId,
        status: current[processorId]?.status ?? 'idle',
        ...next
      }
    }))
  }

  const updateMarkdownResult = (processorId: FileProcessorId, next: Partial<MarkdownResultItem>) => {
    setMarkdownResults((current) => ({
      ...current,
      [processorId]: {
        ...current[processorId],
        processorId,
        status: current[processorId]?.status ?? 'idle',
        ...next
      }
    }))
  }

  const getStatusLabel = (status: keyof typeof STATUS_KEY_MAP) => t(STATUS_KEY_MAP[status])

  const selectFile = async (kind: 'image' | 'document') => {
    const selected = await window.api.file.select({
      properties: ['openFile'],
      filters: kind === 'image' ? IMAGE_FILTERS : DOCUMENT_FILTERS
    })
    const file = selected?.[0] ?? null

    if (!file) {
      return
    }

    if (kind === 'image') {
      if (file.type !== 'image') {
        window.toast.error(t('settings.tool.preprocess.test_panel.invalid_image'))
        return
      }
      setImageFile(file)
      setExtractResults({})
      return
    }

    if (file.type !== 'document') {
      window.toast.error(t('settings.tool.preprocess.test_panel.invalid_document'))
      return
    }
    setDocumentFile(file)
    setMarkdownResults({})
  }

  const runExtractTextTests = async () => {
    if (!imageFile) {
      window.toast.error(t('settings.tool.preprocess.test_panel.no_image_selected'))
      return
    }

    if (extractProcessors.length === 0) {
      window.toast.error(t('settings.tool.preprocess.test_panel.no_extract_processors'))
      return
    }

    setIsRunningExtract(true)
    setExtractResults({})

    await Promise.allSettled(
      extractProcessors.map(async (processor) => {
        updateExtractResult(processor.id, { status: 'running', error: undefined, text: undefined })

        try {
          const result = await extractText(imageFile, processor.id)
          updateExtractResult(processor.id, { status: 'completed', text: result.text })
        } catch (error) {
          logger.error('Extract text test failed', error as Error, { processorId: processor.id, fileId: imageFile.id })
          updateExtractResult(processor.id, { status: 'failed', error: getErrorMessage(error) })
        }
      })
    )

    setIsRunningExtract(false)
  }

  const runMarkdownConversionTests = async () => {
    if (!documentFile) {
      window.toast.error(t('settings.tool.preprocess.test_panel.no_document_selected'))
      return
    }

    if (markdownProcessors.length === 0) {
      window.toast.error(t('settings.tool.preprocess.test_panel.no_markdown_processors'))
      return
    }

    setIsRunningMarkdown(true)
    setMarkdownResults({})

    await Promise.allSettled(
      markdownProcessors.map(async (processor) => {
        updateMarkdownResult(processor.id, {
          status: 'starting',
          progress: 0,
          error: undefined,
          markdownPath: undefined,
          providerTaskId: undefined
        })

        try {
          const startResult = await startMarkdownConversionTask(documentFile, processor.id)
          updateMarkdownResult(processor.id, {
            status: startResult.status,
            progress: startResult.progress,
            providerTaskId: startResult.providerTaskId
          })

          const result = await pollMarkdownConversionTask(startResult.providerTaskId, startResult.processorId, {
            intervalMs: 1500,
            maxAttempts: 120,
            onUpdate: (nextResult) => {
              updateMarkdownResult(processor.id, {
                status: nextResult.status,
                progress: nextResult.progress,
                providerTaskId: startResult.providerTaskId,
                error: nextResult.status === 'failed' ? nextResult.error : undefined,
                markdownPath: nextResult.status === 'completed' ? nextResult.markdownPath : undefined
              })
            }
          })

          updateMarkdownResult(processor.id, {
            status: result.status,
            progress: result.progress,
            providerTaskId: startResult.providerTaskId,
            error: result.status === 'failed' ? result.error : undefined,
            markdownPath: result.status === 'completed' ? result.markdownPath : undefined
          })
        } catch (error) {
          logger.error('Markdown conversion test failed', error as Error, {
            processorId: processor.id,
            fileId: documentFile.id
          })
          updateMarkdownResult(processor.id, {
            status: 'failed',
            error: getErrorMessage(error)
          })
        }
      })
    )

    setIsRunningMarkdown(false)
  }

  const openMarkdownPath = async (markdownPath?: string) => {
    if (!markdownPath) {
      return
    }
    await window.api.file.openPath(markdownPath)
  }

  if (error) {
    return (
      <SettingGroup>
        <SettingTitle>{t('settings.tool.preprocess.test_panel.title')}</SettingTitle>
        <SettingDivider />
        <Alert
          type="error"
          message={t('settings.tool.preprocess.test_panel.load_failed')}
          description={getErrorMessage(error)}
        />
      </SettingGroup>
    )
  }

  return (
    <SettingGroup>
      <SettingTitle>{t('settings.tool.preprocess.test_panel.title')}</SettingTitle>
      <SettingDivider />
      <SettingDescription>{t('settings.tool.preprocess.test_panel.description')}</SettingDescription>

      {isLoading ? (
        <SettingHelpText>{t('settings.tool.preprocess.test_panel.loading')}</SettingHelpText>
      ) : (
        <>
          <SettingSubtitle>{t('settings.tool.preprocess.test_panel.extract_title')}</SettingSubtitle>
          <SettingRow>
            <SettingRowTitle>{t('settings.tool.preprocess.test_panel.selected_image')}</SettingRowTitle>
            <RowFlex className="gap-2">
              <Button variant="outline" size="sm" onClick={() => void selectFile('image')}>
                <FileUp size={14} />
                {t('settings.tool.preprocess.test_panel.select_image')}
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={!imageFile || isRunningExtract}
                onClick={() => void runExtractTextTests()}>
                {isRunningExtract ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                {t('settings.tool.preprocess.test_panel.run_extract')}
              </Button>
            </RowFlex>
          </SettingRow>
          <SettingHelpText>
            {imageFile?.origin_name ?? t('settings.tool.preprocess.test_panel.no_image_selected')}
          </SettingHelpText>

          {extractProcessors.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('settings.tool.preprocess.test_panel.no_extract_processors')}
            />
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {extractProcessors.map((processor) => {
                const result = extractResults[processor.id]
                return (
                  <div
                    key={processor.id}
                    className="rounded-md border border-[var(--color-border)] bg-[var(--color-background-soft)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-[13px]">{processor.id}</div>
                      <div className="text-[12px] text-[var(--color-text-3)]">
                        {getStatusLabel(result?.status ?? 'idle')}
                      </div>
                    </div>
                    {result?.error && <div className="mt-2 text-[12px] text-[var(--color-error)]">{result.error}</div>}
                    {result?.text && (
                      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-background)] p-2 text-[12px] text-[var(--color-text-1)]">
                        {result.text}
                      </pre>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <SettingSubtitle>{t('settings.tool.preprocess.test_panel.markdown_title')}</SettingSubtitle>
          <SettingRow>
            <SettingRowTitle>{t('settings.tool.preprocess.test_panel.selected_document')}</SettingRowTitle>
            <RowFlex className="gap-2">
              <Button variant="outline" size="sm" onClick={() => void selectFile('document')}>
                <FileUp size={14} />
                {t('settings.tool.preprocess.test_panel.select_document')}
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={!documentFile || isRunningMarkdown}
                onClick={() => void runMarkdownConversionTests()}>
                {isRunningMarkdown ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                {t('settings.tool.preprocess.test_panel.run_markdown')}
              </Button>
            </RowFlex>
          </SettingRow>
          <SettingHelpText>
            {documentFile?.origin_name ?? t('settings.tool.preprocess.test_panel.no_document_selected')}
          </SettingHelpText>

          {markdownProcessors.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('settings.tool.preprocess.test_panel.no_markdown_processors')}
            />
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {markdownProcessors.map((processor) => {
                const result = markdownResults[processor.id]
                return (
                  <div
                    key={processor.id}
                    className="rounded-md border border-[var(--color-border)] bg-[var(--color-background-soft)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-[13px]">{processor.id}</div>
                      <div className="text-[12px] text-[var(--color-text-3)]">
                        {getStatusLabel(result?.status ?? 'idle')}
                      </div>
                    </div>
                    {typeof result?.progress === 'number' && (
                      <div className="mt-2 text-[12px] text-[var(--color-text-2)]">
                        {t('settings.tool.preprocess.test_panel.progress', { progress: result.progress })}
                      </div>
                    )}
                    {result?.providerTaskId && (
                      <div className="mt-1 break-all text-[12px] text-[var(--color-text-3)]">
                        {t('settings.tool.preprocess.test_panel.provider_task_id')}: {result.providerTaskId}
                      </div>
                    )}
                    {result?.error && <div className="mt-2 text-[12px] text-[var(--color-error)]">{result.error}</div>}
                    {result?.markdownPath && (
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="break-all text-[12px] text-[var(--color-text-2)]">{result.markdownPath}</div>
                        <Button variant="outline" size="sm" onClick={() => void openMarkdownPath(result.markdownPath)}>
                          {t('settings.tool.preprocess.test_panel.open_output')}
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </SettingGroup>
  )
}

export default FileProcessingTestPanel
