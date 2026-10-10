import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

import { usePreviewHost } from '../../previewContext'

export type PdfDestination = string | unknown[]

export interface PdfOutlineItem {
  dest: PdfDestination | null
  items: PdfOutlineItem[]
  title: string
  url: string | null
}

export type PdfOutlineStatus = 'error' | 'loading' | 'ready'

interface PdfOutlineListProps {
  items: PdfOutlineItem[]
  onNavigate: (destination: PdfDestination) => void
}

function PdfOutlineList({ items, onNavigate }: PdfOutlineListProps) {
  return (
    <ul className="space-y-0.5">
      {items.map((item, index) => (
        <li key={`${item.title}-${index}`}>
          {item.dest ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto min-h-7 w-full justify-start whitespace-normal px-2 py-1 text-left text-xs shadow-none"
              onClick={() => onNavigate(item.dest as PdfDestination)}>
              {item.title}
            </Button>
          ) : item.url ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-auto min-h-7 w-full justify-start whitespace-normal px-2 py-1 text-left text-xs shadow-none">
              <a href={item.url} target="_blank" rel="noreferrer">
                <span className="min-w-0 flex-1">{item.title}</span>
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </Button>
          ) : (
            <span className="block px-2 py-1 text-foreground text-xs">{item.title}</span>
          )}
          {item.items.length > 0 ? (
            <div className="ml-3 border-border-subtle border-l pl-1">
              <PdfOutlineList items={item.items} onNavigate={onNavigate} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

interface PdfOutlineProps {
  className?: string
  items: PdfOutlineItem[]
  onNavigate: (destination: PdfDestination) => void
  status: PdfOutlineStatus
}

export function PdfOutline({ className, items, onNavigate, status }: PdfOutlineProps) {
  const { t } = useTranslation()
  const { options } = usePreviewHost()

  return (
    <nav
      aria-label={t('file_preview.pdf.outline.title')}
      className={cn(
        'flex h-full w-64 shrink-0 flex-col border-border-subtle border-r bg-sidebar text-sidebar-foreground',
        className
      )}>
      <h2 className="flex h-10 shrink-0 items-center border-border-subtle border-b px-3 font-medium text-sm">
        {t('file_preview.pdf.outline.title')}
      </h2>
      <Scrollbar
        className="min-h-0 flex-1 px-2 py-2"
        style={
          options?.bottomInset === 'content'
            ? { paddingBottom: 'calc(0.5rem + var(--file-preview-bottom-inset, 0px))' }
            : undefined
        }>
        {status === 'loading' ? (
          <p role="status" className="px-2 py-1 text-muted-foreground text-xs">
            {t('common.loading')}
          </p>
        ) : status === 'error' ? (
          <p role="alert" className="px-2 py-1 text-error-subtle-foreground text-xs">
            {t('file_preview.pdf.outline.load_error')}
          </p>
        ) : items.length === 0 ? (
          <p className="px-2 py-1 text-muted-foreground text-xs">{t('file_preview.pdf.outline.empty')}</p>
        ) : (
          <PdfOutlineList items={items} onNavigate={onNavigate} />
        )}
      </Scrollbar>
    </nav>
  )
}
