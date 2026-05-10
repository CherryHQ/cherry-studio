import { Badge } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { FileProcessingFeatureSection } from '../utils/fileProcessingMeta'
import { getProcessorNameKey } from '../utils/fileProcessingMeta'
import { ProcessorAvatar } from './ProcessorAvatar'

type ProcessorSidebarProps = {
  featureSections: FileProcessingFeatureSection[]
  activeKey: string
  defaultDocumentProcessor: string | null
  defaultImageProcessor: string | null
  onSelect: (key: string) => void
}

export function ProcessorSidebar({
  activeKey,
  defaultDocumentProcessor,
  defaultImageProcessor,
  featureSections,
  onSelect
}: ProcessorSidebarProps) {
  const { t } = useTranslation()

  return (
    <aside className="flex min-h-0 min-w-[calc(var(--settings-width)+10px)] shrink-0 flex-col border-foreground/[0.05] border-r">
      <div className="shrink-0 px-3.5 pt-4 pb-2">
        <p className="text-foreground/40 text-xs leading-tight" style={{ fontWeight: 500 }}>
          {t('settings.tool.file_processing.sidebar_title')}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 [&::-webkit-scrollbar-thumb]:bg-border/20 [&::-webkit-scrollbar]:w-[2px]">
        <div className="space-y-[2px]">
          {featureSections.map(({ entries, feature }) => {
            return (
              <div key={feature}>
                <p
                  className="px-3 pt-2.5 pb-1 text-foreground/25 text-xs uppercase leading-tight tracking-wider first:pt-1"
                  style={{ fontWeight: 500 }}>
                  {feature === 'image_to_text'
                    ? t('settings.tool.file_processing.features.image_to_text.title')
                    : t('settings.tool.file_processing.features.document_to_markdown.title')}
                </p>
                {entries.map((entry) => {
                  const active = activeKey === entry.key
                  const isDefault =
                    entry.feature === 'image_to_text'
                      ? defaultImageProcessor === entry.processor.id
                      : defaultDocumentProcessor === entry.processor.id

                  return (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => onSelect(entry.key)}
                      className={cn(
                        'relative flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition-all',
                        active
                          ? 'border-primary/15 bg-foreground/[0.06]'
                          : 'border-transparent hover:bg-foreground/[0.03]'
                      )}>
                      {active && (
                        <div className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-0 flex items-center">
                          <div className="h-6 w-2.5 rounded-tl-lg rounded-bl-lg bg-primary/15 blur-[6px]" />
                          <div className="absolute right-0 h-2.5 w-[3px] rounded-full bg-primary/40 blur-[2px]" />
                        </div>
                      )}
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <ProcessorAvatar processorId={entry.processor.id} />
                        <span
                          className={cn(
                            'truncate text-sm leading-tight',
                            active ? 'font-medium text-foreground/85' : 'font-normal text-foreground/55'
                          )}>
                          {t(getProcessorNameKey(entry.processor.id))}
                        </span>
                      </div>
                      {isDefault ? (
                        <Badge className="ml-1 shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0 text-emerald-600 text-xs leading-tight dark:text-emerald-400">
                          {t('common.default')}
                        </Badge>
                      ) : (
                        <ChevronRight
                          size={9}
                          className={cn('shrink-0', active ? 'text-foreground/25' : 'text-foreground/10')}
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
