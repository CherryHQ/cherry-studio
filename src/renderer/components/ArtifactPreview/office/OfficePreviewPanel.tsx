import { EmptyState } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { AlertCircle, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import PptxPreviewPanel from './PptxPreviewPanel'
import WordPreviewPanel from './WordPreviewPanel'

const SUPPORTED_OFFICE_PREVIEW_EXTENSIONS = new Set(['docx', 'pptx'])

export interface OfficePreviewPanelProps {
  filePath: string
  fileName?: string
  sourceFilePath?: string
  sourceSize?: number
  className?: string
  refreshKey?: number
  onOpenExternal?: () => void
}

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

function UnsupportedOfficePreview({ extension, onOpenExternal }: { extension: string; onOpenExternal?: () => void }) {
  const { t } = useTranslation()
  return (
    <EmptyState
      icon={FileText}
      title={t('agent.preview_pane.office.title', { extension: extension ? `.${extension}` : '' })}
      description={t('agent.preview_pane.office.description')}
      actionLabel={onOpenExternal ? t('common.open_in', { name: t('agent.preview_pane.default_app') }) : undefined}
      onAction={onOpenExternal}
    />
  )
}

function OfficePreviewError({ onOpenExternal }: { onOpenExternal?: () => void }) {
  const { t } = useTranslation()
  return (
    <EmptyState
      icon={AlertCircle}
      title={t('common.error')}
      description={t('files.preview.error')}
      actionLabel={onOpenExternal ? t('common.open_in', { name: t('agent.preview_pane.default_app') }) : undefined}
      onAction={onOpenExternal}
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
  onOpenExternal
}: OfficePreviewPanelProps) {
  const extension = getPreviewExtension(filePath, fileName)
  const displayName = getFileDisplayName(filePath, fileName)
  const supported = SUPPORTED_OFFICE_PREVIEW_EXTENSIONS.has(extension)
  const previewFilePath = sourceFilePath ?? (isAbsoluteFilePath(filePath) ? filePath : undefined)

  if (!supported) {
    return (
      <div className={cn('flex h-full min-h-[320px] min-w-0 flex-col bg-background', className)}>
        <UnsupportedOfficePreview extension={extension} onOpenExternal={onOpenExternal} />
      </div>
    )
  }

  if (!previewFilePath) {
    return (
      <div className={cn('flex h-full min-h-[320px] min-w-0 flex-col bg-background', className)}>
        <OfficePreviewError onOpenExternal={onOpenExternal} />
      </div>
    )
  }

  return (
    <div className={cn('flex h-full min-h-[320px] min-w-0 flex-col overflow-hidden bg-background', className)}>
      <div className="min-h-0 flex-1 overflow-hidden">
        {extension === 'docx' ? (
          <WordPreviewPanel
            key={`${previewFilePath}-${refreshKey}`}
            filePath={previewFilePath}
            fileName={displayName}
            refreshKey={refreshKey}
            sourceSize={sourceSize}
          />
        ) : (
          <PptxPreviewPanel
            key={`${previewFilePath}-${refreshKey}`}
            filePath={previewFilePath}
            fileName={displayName}
            refreshKey={refreshKey}
            sourceSize={sourceSize}
          />
        )}
      </div>
    </div>
  )
}

export default OfficePreviewPanel
