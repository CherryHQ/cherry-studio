import { cn } from '@cherrystudio/ui/lib/utils'
import { useDefaultProcessors, useFileProcessors } from '@renderer/hooks/useFileProcessing'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { FileText } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import ProcessorListItem from './components/ProcessorListItem'

const FileProcessingSettings: FC = () => {
  const { t } = useTranslation()
  const { processors } = useFileProcessors()
  const { defaultMarkdownConversionProcessor, defaultTextExtractionProcessor } = useDefaultProcessors()
  const navigate = useNavigate()
  const location = useLocation()

  const defaultProcessorIds = [defaultMarkdownConversionProcessor, defaultTextExtractionProcessor].filter(
    (processorId): processorId is string => Boolean(processorId)
  )

  // Get the currently active view
  const getActiveView = () => {
    const path = location.pathname

    if (path === '/settings/file-processing/general' || path === '/settings/file-processing') {
      return 'general'
    }

    // Check if it's a processor page
    for (const processor of processors) {
      if (path === `/settings/file-processing/processor/${processor.id}`) {
        return processor.id
      }
    }

    return 'general'
  }

  const activeView = getActiveView()

  return (
    <div className="flex h-[calc(100vh-var(--navbar-height)-6px)] w-full flex-1 flex-row overflow-hidden">
      {/* Sidebar: Processor list */}
      <div className="flex h-[calc(100vh-var(--navbar-height))] w-(--settings-width) flex-col gap-2 border-border border-r p-2">
        <div
          className={cn(
            'flex cursor-pointer flex-row items-center gap-2 rounded-3xs p-2 hover:bg-ghost-hover',
            activeView === 'general' && 'bg-ghost-hover'
          )}
          onClick={() => navigate({ to: '/settings/file-processing/general' })}>
          <FileText size={16} />
          {t('settings.file_processing.title')}
        </div>
        <div className="border-border border-b" />

        <div className="flex flex-col gap-1">
          {processors.map((processor) => (
            <ProcessorListItem.Root
              key={processor.id}
              processor={processor}
              activeId={activeView}
              defaultIds={defaultProcessorIds}>
              <ProcessorListItem.Icon />
              <ProcessorListItem.Label />
              <ProcessorListItem.Badge />
            </ProcessorListItem.Root>
          ))}
        </div>
      </div>

      {/* Right column: Content area */}
      <div className="flex flex-1">
        <Outlet />
      </div>
    </div>
  )
}

export default FileProcessingSettings
