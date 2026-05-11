import { Badge, Button } from '@cherrystudio/ui'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { formatErrorMessage } from '@renderer/utils/error'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type {
  FileProcessingArtifact,
  FileProcessingTaskResult,
  FileProcessingTaskStatus
} from '@shared/data/types/fileProcessing'
import { mergeFileProcessorPresets } from '@shared/data/utils/fileProcessingUtils'
import type { FileMetadata } from '@types'
import { CheckCircle2, CircleAlert, FileText, Image, Loader2, Play, Upload } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAvailableFileProcessors } from '../FileProcessingSettings/hooks/useAvailableFileProcessors'
import { getProcessorNameKey } from '../FileProcessingSettings/utils/fileProcessingMeta'

const FILE_PROCESSING_KEYS = {
  overrides: 'feature.file_processing.overrides'
} as const

const POLL_INTERVAL_MS = 1000
const TEXT_PREVIEW_LIMIT = 500

type LabFeature = Extract<FileProcessorFeature, 'image_to_text' | 'document_to_markdown'>
type LabRunStatus = FileProcessingTaskStatus | 'idle' | 'starting'

type LabSectionConfig = {
  feature: LabFeature
  titleKey: string
  descriptionKey: string
  selectKey: string
  startKey: string
  noFileKey: string
  fileFilterNameKey: string
  extensions: string[]
  icon: ReactNode
  testId: string
}

type ProcessorRunState = {
  processorId: FileProcessorId
  status: LabRunStatus
  progress: number
  taskId?: string
  startedAt?: number
  durationMs?: number
  artifacts?: FileProcessingArtifact[]
  error?: string
}

type RunStateByFeature = Record<LabFeature, Partial<Record<FileProcessorId, ProcessorRunState>>>

const LAB_SECTIONS: readonly LabSectionConfig[] = [
  {
    feature: 'image_to_text',
    titleKey: 'settings.componentLab.fileProcessing.ocr.title',
    descriptionKey: 'settings.componentLab.fileProcessing.ocr.description',
    selectKey: 'settings.componentLab.fileProcessing.ocr.select',
    startKey: 'settings.componentLab.fileProcessing.ocr.start',
    noFileKey: 'settings.componentLab.fileProcessing.ocr.noFile',
    fileFilterNameKey: 'settings.componentLab.fileProcessing.ocr.fileFilterName',
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif', 'gif'],
    icon: <Image className="size-4" />,
    testId: 'ocr'
  },
  {
    feature: 'document_to_markdown',
    titleKey: 'settings.componentLab.fileProcessing.markdown.title',
    descriptionKey: 'settings.componentLab.fileProcessing.markdown.description',
    selectKey: 'settings.componentLab.fileProcessing.markdown.select',
    startKey: 'settings.componentLab.fileProcessing.markdown.start',
    noFileKey: 'settings.componentLab.fileProcessing.markdown.noFile',
    fileFilterNameKey: 'settings.componentLab.fileProcessing.markdown.fileFilterName',
    extensions: ['pdf', 'doc', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'],
    icon: <FileText className="size-4" />,
    testId: 'markdown'
  }
]

const TERMINAL_STATUSES = new Set<FileProcessingTaskStatus>(['completed', 'failed', 'cancelled'])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function getProcessorsForFeature(
  processors: readonly FileProcessorMerged[],
  feature: LabFeature,
  availableProcessorIds: ReadonlySet<FileProcessorId>
): FileProcessorMerged[] {
  return processors.filter((processor) => {
    if (!availableProcessorIds.has(processor.id)) {
      return false
    }

    return processor.capabilities.some((capability) => capability.feature === feature)
  })
}

function getDurationSeconds(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return '-'
  }

  return (durationMs / 1000).toFixed(1)
}

function getArtifactPreview(artifact: FileProcessingArtifact): string {
  if (artifact.kind === 'file') {
    return artifact.path
  }

  return artifact.text.length > TEXT_PREVIEW_LIMIT ? `${artifact.text.slice(0, TEXT_PREVIEW_LIMIT)}...` : artifact.text
}

function createInitialRunState(processorId: FileProcessorId): ProcessorRunState {
  return {
    processorId,
    status: 'starting',
    progress: 0,
    startedAt: Date.now()
  }
}

function buildTerminalRunState(result: FileProcessingTaskResult, startedAt?: number): Partial<ProcessorRunState> {
  const durationMs = startedAt ? Date.now() - startedAt : undefined

  if (result.status === 'completed') {
    return {
      status: result.status,
      progress: result.progress,
      durationMs,
      artifacts: result.artifacts
    }
  }

  if (result.status === 'failed') {
    return {
      status: result.status,
      progress: result.progress,
      durationMs,
      error: result.error
    }
  }

  if (result.status === 'cancelled') {
    return {
      status: result.status,
      progress: result.progress,
      durationMs,
      error: result.reason
    }
  }

  return {
    status: result.status,
    progress: result.progress
  }
}

function StatusIcon({ status }: { status: LabRunStatus }) {
  if (status === 'completed') {
    return <CheckCircle2 className="size-4 text-success" />
  }

  if (status === 'failed' || status === 'cancelled') {
    return <CircleAlert className="size-4 text-destructive" />
  }

  if (status === 'processing' || status === 'pending' || status === 'starting') {
    return <Loader2 className="size-4 animate-spin text-muted-foreground" />
  }

  return null
}

function ProcessorResultCard({ processor, state }: { processor: FileProcessorMerged; state?: ProcessorRunState }) {
  const { t } = useTranslation()
  const status = state?.status ?? 'idle'

  return (
    <div
      className="rounded-[12px] border border-border bg-background p-3"
      data-testid={`file-processing-result-${processor.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground text-sm">{t(getProcessorNameKey(processor.id))}</div>
          <div className="mt-1 text-muted-foreground text-xs">
            {t('settings.componentLab.fileProcessing.duration', {
              seconds: getDurationSeconds(state?.durationMs)
            })}
          </div>
        </div>
        <Badge variant={status === 'failed' || status === 'cancelled' ? 'destructive' : 'outline'} className="gap-1">
          <StatusIcon status={status} />
          {t(`settings.componentLab.fileProcessing.status.${status}`)}
        </Badge>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${state?.progress ?? 0}%` }}
        />
      </div>

      {state?.taskId ? (
        <div className="mt-2 truncate text-muted-foreground text-xs">
          {t('settings.componentLab.fileProcessing.taskId')}: {state.taskId}
        </div>
      ) : null}

      {state?.error ? (
        <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-[8px] border border-destructive/20 bg-destructive/5 p-2 font-mono text-destructive text-xs leading-5">
          {state.error}
        </pre>
      ) : null}

      {state?.artifacts?.length ? (
        <div className="mt-3 space-y-2">
          {state.artifacts.map((artifact, index) => (
            <div key={`${artifact.kind}-${index}`} className="rounded-[8px] border border-border/70 bg-muted/20 p-2">
              <div className="mb-1 text-muted-foreground text-xs">
                {artifact.kind === 'file'
                  ? t('settings.componentLab.fileProcessing.artifact.file')
                  : t('settings.componentLab.fileProcessing.artifact.text')}
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-foreground text-xs leading-5">
                {getArtifactPreview(artifact)}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const ComponentLabFileProcessingSettings: FC = () => {
  const { t } = useTranslation()
  const [preferences] = useMultiplePreferences(FILE_PROCESSING_KEYS, { optimistic: false })
  const availableProcessors = useAvailableFileProcessors()
  const processors = useMemo(() => mergeFileProcessorPresets(preferences.overrides ?? {}), [preferences.overrides])
  const processorsByFeature = useMemo(() => {
    return {
      image_to_text: getProcessorsForFeature(processors, 'image_to_text', availableProcessors.processorIds),
      document_to_markdown: getProcessorsForFeature(
        processors,
        'document_to_markdown',
        availableProcessors.processorIds
      )
    } satisfies Record<LabFeature, FileProcessorMerged[]>
  }, [availableProcessors.processorIds, processors])

  const [selectedFiles, setSelectedFiles] = useState<Partial<Record<LabFeature, FileMetadata>>>({})
  const [runStates, setRunStates] = useState<RunStateByFeature>({
    document_to_markdown: {},
    image_to_text: {}
  })
  const [runningFeatures, setRunningFeatures] = useState<Partial<Record<LabFeature, boolean>>>({})
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<LabFeature, string>>>({})

  const mountedRef = useRef(true)
  const runIdRef = useRef<Record<LabFeature, number>>({
    document_to_markdown: 0,
    image_to_text: 0
  })

  useEffect(() => {
    return () => {
      mountedRef.current = false
      runIdRef.current.document_to_markdown += 1
      runIdRef.current.image_to_text += 1
    }
  }, [])

  const updateProcessorState = useCallback(
    (feature: LabFeature, processorId: FileProcessorId, updates: Partial<ProcessorRunState>) => {
      if (!mountedRef.current) {
        return
      }

      setRunStates((current) => {
        const previous = current[feature][processorId]

        return {
          ...current,
          [feature]: {
            ...current[feature],
            [processorId]: {
              processorId,
              status: 'idle',
              progress: 0,
              ...previous,
              ...updates
            }
          }
        }
      })
    },
    []
  )

  const isCurrentRun = useCallback((feature: LabFeature, runId: number) => {
    return mountedRef.current && runIdRef.current[feature] === runId
  }, [])

  const pollTask = useCallback(
    async (feature: LabFeature, processorId: FileProcessorId, taskId: string, startedAt: number, runId: number) => {
      while (isCurrentRun(feature, runId)) {
        const result = await window.api.fileProcessing.getTask({ taskId })
        updateProcessorState(feature, processorId, buildTerminalRunState(result, startedAt))

        if (TERMINAL_STATUSES.has(result.status)) {
          return
        }

        await sleep(POLL_INTERVAL_MS)
      }
    },
    [isCurrentRun, updateProcessorState]
  )

  const runProcessor = useCallback(
    async (feature: LabFeature, file: FileMetadata, processorId: FileProcessorId, runId: number) => {
      const startedAt = Date.now()

      try {
        const startResult = await window.api.fileProcessing.startTask({
          feature,
          file,
          processorId
        })

        if (!isCurrentRun(feature, runId)) {
          return
        }

        updateProcessorState(feature, processorId, {
          taskId: startResult.taskId,
          status: startResult.status,
          progress: startResult.progress,
          startedAt
        })

        await pollTask(feature, processorId, startResult.taskId, startedAt, runId)
      } catch (error) {
        if (!isCurrentRun(feature, runId)) {
          return
        }

        updateProcessorState(feature, processorId, {
          status: 'failed',
          progress: 0,
          durationMs: Date.now() - startedAt,
          error: formatErrorMessage(error)
        })
      }
    },
    [isCurrentRun, pollTask, updateProcessorState]
  )

  const handleSelectFile = useCallback(
    async (section: LabSectionConfig) => {
      setSectionErrors((current) => ({ ...current, [section.feature]: undefined }))

      try {
        const files = await window.api.file.select({
          properties: ['openFile'],
          filters: [
            {
              name: t(section.fileFilterNameKey),
              extensions: section.extensions
            }
          ]
        })

        const file = files?.[0]

        if (file) {
          setSelectedFiles((current) => ({ ...current, [section.feature]: file }))
        }
      } catch (error) {
        setSectionErrors((current) => ({
          ...current,
          [section.feature]: formatErrorMessage(error)
        }))
      }
    },
    [t]
  )

  const handleStart = useCallback(
    async (section: LabSectionConfig) => {
      const file = selectedFiles[section.feature]
      const processorsForFeature = processorsByFeature[section.feature]

      if (!file || runningFeatures[section.feature]) {
        return
      }

      if (!processorsForFeature.length) {
        setSectionErrors((current) => ({
          ...current,
          [section.feature]: t('settings.componentLab.fileProcessing.noProcessors')
        }))
        return
      }

      const runId = runIdRef.current[section.feature] + 1
      runIdRef.current[section.feature] = runId

      setSectionErrors((current) => ({ ...current, [section.feature]: undefined }))
      setRunningFeatures((current) => ({ ...current, [section.feature]: true }))
      setRunStates((current) => ({
        ...current,
        [section.feature]: Object.fromEntries(
          processorsForFeature.map((processor) => [processor.id, createInitialRunState(processor.id)])
        )
      }))

      await Promise.allSettled(
        processorsForFeature.map((processor) => runProcessor(section.feature, file, processor.id, runId))
      )

      if (isCurrentRun(section.feature, runId)) {
        setRunningFeatures((current) => ({ ...current, [section.feature]: false }))
      }
    },
    [isCurrentRun, processorsByFeature, runProcessor, runningFeatures, selectedFiles, t]
  )

  return (
    <div className="space-y-4">
      <div>
        <div className="font-medium text-foreground text-sm">{t('settings.componentLab.fileProcessing.title')}</div>
        <div className="mt-1 text-muted-foreground text-xs">
          {t('settings.componentLab.fileProcessing.description')}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {LAB_SECTIONS.map((section) => {
          const file = selectedFiles[section.feature]
          const processorsForFeature = processorsByFeature[section.feature]
          const isRunning = Boolean(runningFeatures[section.feature])
          const sectionRunStates = runStates[section.feature]

          return (
            <section
              key={section.feature}
              className="rounded-[12px] border border-border bg-background p-4"
              data-testid={`file-processing-lab-${section.testId}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium text-foreground text-sm">
                    {section.icon}
                    {t(section.titleKey)}
                  </div>
                  <div className="mt-1 text-muted-foreground text-xs">{t(section.descriptionKey)}</div>
                </div>
                <Badge variant="secondary">
                  {t('settings.componentLab.fileProcessing.processorCount', {
                    count: processorsForFeature.length
                  })}
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void handleSelectFile(section)}>
                  <Upload className="size-4" />
                  {t(section.selectKey)}
                </Button>
                <Button
                  size="sm"
                  loading={isRunning}
                  disabled={!file || isRunning}
                  onClick={() => void handleStart(section)}>
                  <Play className="size-4" />
                  {t(section.startKey)}
                </Button>
              </div>

              <div className="mt-3 truncate rounded-[8px] border border-border/70 bg-muted/20 px-3 py-2 text-muted-foreground text-xs">
                {file ? file.path : t(section.noFileKey)}
              </div>

              {sectionErrors[section.feature] ? (
                <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-[8px] border border-destructive/20 bg-destructive/5 p-2 font-mono text-destructive text-xs leading-5">
                  {sectionErrors[section.feature]}
                </pre>
              ) : null}

              <div className="mt-4 grid gap-3">
                {processorsForFeature.map((processor) => (
                  <ProcessorResultCard
                    key={processor.id}
                    processor={processor}
                    state={sectionRunStates[processor.id]}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

export default ComponentLabFileProcessingSettings
