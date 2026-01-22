import { DividerWithText } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import {
  useAvailableImageProcessors,
  useDefaultProcessors,
  useDocumentProcessors
} from '@renderer/hooks/useFileProcessors'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { FileText } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import ProcessorListItem from './components/ProcessorListItem'

const FileProcessingSettings: FC = () => {
  const { t } = useTranslation()
  const documentProcessors = useDocumentProcessors()
  const imageProcessors = useAvailableImageProcessors()
  const { defaultDocumentProcessor, defaultImageProcessor } = useDefaultProcessors()
  const navigate = useNavigate()
  const location = useLocation()

  // Get the currently active view
  const getActiveView = () => {
    const path = location.pathname

    if (path === '/settings/file-processing/general' || path === '/settings/file-processing') {
      return 'general'
    }

    // Check if it's a processor page
    const allProcessors = [...documentProcessors, ...imageProcessors]
    for (const processor of allProcessors) {
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

        {/* Document processors */}
        <DividerWithText text={t('settings.file_processing.document_processors')} />
        <div className="flex flex-col gap-1">
          {documentProcessors.map((processor) => (
            <ProcessorListItem
              key={processor.id}
              processor={processor}
              isActive={activeView === processor.id}
              isDefault={defaultDocumentProcessor === processor.id}
              isDocument={true}
            />
          ))}
        </div>

        {/* Image processors */}
        <DividerWithText text={t('settings.file_processing.image_processors')} />
        <div className="flex flex-col gap-1">
          {imageProcessors.map((processor) => (
            <ProcessorListItem
              key={processor.id}
              processor={processor}
              isActive={activeView === processor.id}
              isDefault={defaultImageProcessor === processor.id}
              isDocument={false}
            />
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
