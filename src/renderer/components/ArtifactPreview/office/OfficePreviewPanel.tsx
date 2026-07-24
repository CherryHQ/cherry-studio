import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { EmptyState, LoadingState } from '@renderer/components/chat/primitives'
import { AlertCircle, FileText } from 'lucide-react'
import { type ComponentType, type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('OfficePreviewPanel')

interface OfficeDocumentPreviewProps {
  filePath: string
  fileName: string
  refreshKey: number
  sourceSize?: number
  actions?: ReactNode
}

type OfficeDocumentPreviewPanel = ComponentType<OfficeDocumentPreviewProps>

export interface OfficePreviewPanelProps {
  filePath: string
  fileName?: string
  sourceFilePath?: string
  sourceSize?: number
  className?: string
  refreshKey?: number
  actions?: ReactNode
}

let wordPreviewPanelPromise: Promise<OfficeDocumentPreviewPanel> | null = null
let pptxPreviewPanelPromise: Promise<OfficeDocumentPreviewPanel> | null = null
let xlsxPreviewPanelPromise: Promise<OfficeDocumentPreviewPanel> | null = null

function loadWordPreviewPanel() {
  wordPreviewPanelPromise ??= import('./WordPreviewPanel')
    .then((module) => module.default)
    .catch((err: unknown) => {
      wordPreviewPanelPromise = null
      throw err
    })
  return wordPreviewPanelPromise
}

function loadPptxPreviewPanel() {
  pptxPreviewPanelPromise ??= import('./PptxPreviewPanel')
    .then((module) => module.default)
    .catch((err: unknown) => {
      pptxPreviewPanelPromise = null
      throw err
    })
  return pptxPreviewPanelPromise
}

function loadXlsxPreviewPanel() {
  xlsxPreviewPanelPromise ??= import('./XlsxPreviewPanel')
    .then((module) => module.XlsxPreviewPanel)
    .catch((err: unknown) => {
      xlsxPreviewPanelPromise = null
      throw err
    })
  return xlsxPreviewPanelPromise
}

// Extension → lazy panel loader. Doubles as the source of truth for which office
// documents get an inline preview; anything not listed falls back to "open externally".
const OFFICE_PREVIEW_LOADERS: Record<string, () => Promise<OfficeDocumentPreviewPanel>> = {
  docx: loadWordPreviewPanel,
  pptx: loadPptxPreviewPanel,
  xlsx: loadXlsxPreviewPanel
}

const SUPPORTED_OFFICE_PREVIEW_EXTENSIONS = new Set(Object.keys(OFFICE_PREVIEW_LOADERS))

function extOf(name: string | undefined): string {
  if (!name) return ''
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

function getFileDisplayName(filePath: string, fileName?: string): string {
  if (fileName) return fileName
  const segments = filePath.replace(/\\/g, '/').split('/')
  return segments.at(-1) ?? filePath
}

function getPreviewExtension(filePath: string, fileName?: string): string {
  const fromName = extOf(fileName)
  if (fromName) return fromName
  return extOf(filePath)
}

function isAbsoluteFilePath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)
}

function UnsupportedOfficePreview({ extension, actions }: { extension: string; actions?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <EmptyState
      icon={FileText}
      title={t('agent.preview_pane.office.title', { extension: extension ? `.${extension}` : '' })}
      description={t('agent.preview_pane.office.description')}
      actions={actions}
    />
  )
}

function OfficePreviewError({ actions }: { actions?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <EmptyState icon={AlertCircle} title={t('common.error')} description={t('files.preview.error')} actions={actions} />
  )
}

function SupportedOfficePreview({
  extension,
  filePath,
  fileName,
  refreshKey,
  sourceSize,
  actions
}: OfficeDocumentPreviewProps & { extension: string }) {
  const { t } = useTranslation()
  const [loadedPreview, setLoadedPreview] = useState<{
    extension: string
    Component: OfficeDocumentPreviewPanel
  } | null>(null)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const PreviewPanel = loadedPreview?.extension === extension ? loadedPreview.Component : null

  useEffect(() => {
    if (PreviewPanel) return

    let cancelled = false
    setLoadError(null)

    const loader = OFFICE_PREVIEW_LOADERS[extension]
    if (!loader) return
    loader()
      .then((Component) => {
        if (!cancelled) setLoadedPreview({ extension, Component })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error(`Failed to load ${extension} preview panel`, normalized)
        setLoadError(normalized)
      })

    return () => {
      cancelled = true
    }
  }, [extension, PreviewPanel])

  if (loadError) {
    return <OfficePreviewError actions={actions} />
  }

  if (!PreviewPanel) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <LoadingState label={t('common.loading')} />
      </div>
    )
  }

  return (
    <PreviewPanel
      filePath={filePath}
      fileName={fileName}
      refreshKey={refreshKey}
      sourceSize={sourceSize}
      actions={actions}
    />
  )
}

export function OfficePreviewPanel({
  filePath,
  fileName,
  sourceFilePath,
  sourceSize,
  className,
  refreshKey = 0,
  actions
}: OfficePreviewPanelProps) {
  const extension = getPreviewExtension(filePath, fileName)
  const displayName = getFileDisplayName(filePath, fileName)
  const supported = SUPPORTED_OFFICE_PREVIEW_EXTENSIONS.has(extension)
  const previewFilePath = sourceFilePath ?? (isAbsoluteFilePath(filePath) ? filePath : undefined)

  if (!supported) {
    return (
      <div className={cn('flex h-full min-h-[320px] min-w-0 flex-col bg-background', className)}>
        <UnsupportedOfficePreview extension={extension} actions={actions} />
      </div>
    )
  }

  if (!previewFilePath) {
    return (
      <div className={cn('flex h-full min-h-[320px] min-w-0 flex-col bg-background', className)}>
        <OfficePreviewError actions={actions} />
      </div>
    )
  }

  return (
    <div className={cn('flex h-full min-h-[320px] min-w-0 flex-col overflow-hidden bg-background', className)}>
      <div className="min-h-0 flex-1 overflow-hidden">
        <SupportedOfficePreview
          key={`${previewFilePath}-${refreshKey}`}
          extension={extension}
          filePath={previewFilePath}
          fileName={displayName}
          refreshKey={refreshKey}
          sourceSize={sourceSize}
          actions={actions}
        />
      </div>
    </div>
  )
}

export default OfficePreviewPanel
