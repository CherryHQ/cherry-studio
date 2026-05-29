import { Badge, Button } from '@cherrystudio/ui'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { useJob, useJobProgress } from '@renderer/hooks/useJob'
import { formatErrorMessage } from '@renderer/utils/error'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'
import type { FileProcessingArtifact, FileProcessingJobOutput } from '@shared/data/types/fileProcessing'
import type { FilePath } from '@shared/file/types'
import type { FileMetadata } from '@types'
import { CheckCircle2, CircleAlert, FileText, Image, Loader2, Play, Upload } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAvailableFileProcessors } from '../FileProcessingSettings/hooks/useAvailableFileProcessors'
import { getProcessorNameKey } from '../FileProcessingSettings/utils/fileProcessingMeta'

const FILE_PROCESSING_KEYS = {
  overrides: 'feature.file_processing.overrides'
} as const

const TEXT_PREVIEW_LIMIT = 500

type LabFeature = Extract<FileProcessorFeature, 'image_to_text' | 'document_to_markdown'>
type LabRunStatus = JobSnapshot['status'] | 'idle' | 'starting'

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

type ProcessorRun = {
  jobId: string
  startedAt: number
}

type RunMap = Record<LabFeature, Partial<Record<FileProcessorId, ProcessorRun>>>

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
    return artifact.fileEntryId
  }

  return artifact.text.length > TEXT_PREVIEW_LIMIT ? `${artifact.text.slice(0, TEXT_PREVIEW_LIMIT)}...` : artifact.text
}

function StatusIcon({ status }: { status: LabRunStatus }) {
  if (status === 'completed') {
    return <CheckCircle2 className="size-4 text-success" />
  }

  if (status === 'failed' || status === 'cancelled') {
    return <CircleAlert className="size-4 text-destructive" />
  }

  if (status === 'running' || status === 'pending' || status === 'delayed' || status === 'starting') {
    return <Loader2 className="size-4 animate-spin text-muted-foreground" />
  }

  return null
}

function ProcessorResultCard({ processor, run }: { processor: FileProcessorMerged; run?: ProcessorRun }) {
  return (
    <div
      className="rounded-xl border border-border bg-background p-3"
      data-testid={`file-processing-result-${processor.id}`}>
      {run ? (
        <ProcessorJobView processor={processor} jobId={run.jobId} startedAt={run.startedAt} />
      ) : (
        <ProcessorIdleHeader processor={processor} />
      )}
    </div>
  )
}

function ProcessorIdleHeader({ processor }: { processor: FileProcessorMerged }) {
  const { t } = useTranslation()

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground text-sm">{t(getProcessorNameKey(processor.id))}</div>
          <div className="mt-1 text-muted-foreground text-xs">
            {t('settings.componentLab.fileProcessing.duration', { seconds: '-' })}
          </div>
        </div>
        <Badge variant="outline" className="gap-1">
          <StatusIcon status="idle" />
          {t(`settings.componentLab.fileProcessing.status.idle`)}
        </Badge>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: '0%' }} />
      </div>
    </>
  )
}

function ProcessorJobView({
  processor,
  jobId,
  startedAt
}: {
  processor: FileProcessorMerged
  jobId: string
  startedAt: number
}) {
  const { t } = useTranslation()
  const { data: snapshot, isTerminal } = useJob(jobId)
  const jobProgress = useJobProgress(jobId)

  const status: LabRunStatus = snapshot?.status ?? 'starting'
  const artifact = useMemo<FileProcessingArtifact | undefined>(() => {
    if (!isTerminal || snapshot?.status !== 'completed') return undefined
    return (snapshot.output as FileProcessingJobOutput | undefined)?.artifact
  }, [isTerminal, snapshot?.output, snapshot?.status])
  const errorMessage = useMemo(() => {
    if (!isTerminal) return undefined
    if (snapshot?.status === 'failed') return snapshot.error?.message
    if (snapshot?.status === 'cancelled') return snapshot.error?.message ?? 'cancelled'
    return undefined
  }, [isTerminal, snapshot])
  const durationMs = useMemo(() => (isTerminal ? Date.now() - startedAt : undefined), [isTerminal, startedAt])
  const displayProgress = status === 'completed' ? 100 : (jobProgress?.progress ?? 0)

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground text-sm">{t(getProcessorNameKey(processor.id))}</div>
          <div className="mt-1 text-muted-foreground text-xs">
            {t('settings.componentLab.fileProcessing.duration', { seconds: getDurationSeconds(durationMs) })}
          </div>
        </div>
        <Badge variant={status === 'failed' || status === 'cancelled' ? 'destructive' : 'outline'} className="gap-1">
          <StatusIcon status={status} />
          {t(`settings.componentLab.fileProcessing.status.${status}`)}
        </Badge>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${displayProgress}%` }} />
      </div>

      <div className="mt-2 truncate text-muted-foreground text-xs">
        {t('settings.componentLab.fileProcessing.jobId')}: {jobId}
      </div>

      {errorMessage ? (
        <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-destructive/20 bg-destructive/5 p-2 font-mono text-destructive text-xs leading-5">
          {errorMessage}
        </pre>
      ) : null}

      {artifact ? (
        <div className="mt-3 space-y-2">
          <div className="rounded-lg border border-border/70 bg-muted/20 p-2">
            <div className="mb-1 text-muted-foreground text-xs">
              {artifact.kind === 'file'
                ? t('settings.componentLab.fileProcessing.artifact.file')
                : t('settings.componentLab.fileProcessing.artifact.text')}
            </div>
            <pre className="wrap-break-word max-h-40 overflow-auto whitespace-pre-wrap font-mono text-foreground text-xs leading-5">
              {getArtifactPreview(artifact)}
            </pre>
          </div>
        </div>
      ) : null}
    </>
  )
}

const ComponentLabFileProcessingSettings: FC = () => {
  const { t } = useTranslation()
  const [preferences] = useMultiplePreferences(FILE_PROCESSING_KEYS, { optimistic: false })
  const availableProcessors = useAvailableFileProcessors()
  const processors = useMemo<FileProcessorMerged[]>(() => {
    return PRESETS_FILE_PROCESSORS.map((preset) => {
      const override = preferences.overrides?.[preset.id]

      return {
        ...preset,
        ...override,
        capabilities: preset.capabilities.map((capability) => ({
          ...capability,
          ...override?.capabilities?.[capability.feature]
        }))
      }
    })
  }, [preferences.overrides])
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
  const [runs, setRuns] = useState<RunMap>({
    document_to_markdown: {},
    image_to_text: {}
  })
  const [startingFeatures, setStartingFeatures] = useState<Partial<Record<LabFeature, boolean>>>({})
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<LabFeature, string>>>({})

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

      if (!file || startingFeatures[section.feature]) {
        return
      }

      if (!processorsForFeature.length) {
        setSectionErrors((current) => ({
          ...current,
          [section.feature]: t('settings.componentLab.fileProcessing.noProcessors')
        }))
        return
      }

      setSectionErrors((current) => ({ ...current, [section.feature]: undefined }))
      setStartingFeatures((current) => ({ ...current, [section.feature]: true }))
      // Clear stale runs from a previous file selection.
      setRuns((current) => ({ ...current, [section.feature]: {} }))

      const startedAt = Date.now()
      const fileEntry = window.api.file.ensureExternalEntry({ externalPath: file.path as FilePath })
      const results = await Promise.allSettled(
        processorsForFeature.map(async (processor) => {
          const entry = await fileEntry
          const job = await window.api.fileProcessing.startJob({
            feature: section.feature,
            fileEntryId: entry.id,
            processorId: processor.id
          })
          return { processorId: processor.id, jobId: job.id }
        })
      )

      const nextRuns: Partial<Record<FileProcessorId, ProcessorRun>> = {}
      const errors: string[] = []
      for (const result of results) {
        if (result.status === 'fulfilled') {
          nextRuns[result.value.processorId] = { jobId: result.value.jobId, startedAt }
        } else {
          errors.push(formatErrorMessage(result.reason))
        }
      }

      setRuns((current) => ({ ...current, [section.feature]: nextRuns }))
      if (errors.length) {
        setSectionErrors((current) => ({ ...current, [section.feature]: errors.join('\n') }))
      }
      setStartingFeatures((current) => ({ ...current, [section.feature]: false }))
    },
    [processorsByFeature, selectedFiles, startingFeatures, t]
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
          const isStarting = Boolean(startingFeatures[section.feature])
          const sectionRuns = runs[section.feature]

          return (
            <section
              key={section.feature}
              className="rounded-xl border border-border bg-background p-4"
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
                  loading={isStarting}
                  disabled={!file || isStarting}
                  onClick={() => void handleStart(section)}>
                  <Play className="size-4" />
                  {t(section.startKey)}
                </Button>
              </div>

              <div className="mt-3 truncate rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-muted-foreground text-xs">
                {file ? file.path : t(section.noFileKey)}
              </div>

              {sectionErrors[section.feature] ? (
                <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-destructive/20 bg-destructive/5 p-2 font-mono text-destructive text-xs leading-5">
                  {sectionErrors[section.feature]}
                </pre>
              ) : null}

              <div className="mt-4 grid gap-3">
                {processorsForFeature.map((processor) => (
                  <ProcessorResultCard key={processor.id} processor={processor} run={sectionRuns[processor.id]} />
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
