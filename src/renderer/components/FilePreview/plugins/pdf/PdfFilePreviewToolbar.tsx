import { Input } from '@cherrystudio/ui'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right'
import ListTree from 'lucide-react/dist/esm/icons/list-tree'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import ZoomIn from 'lucide-react/dist/esm/icons/zoom-in'
import ZoomOut from 'lucide-react/dist/esm/icons/zoom-out'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewToolbar } from '../../FilePreviewToolbar'
import { FilePreviewToolbarButton } from '../../FilePreviewToolbarButton'

interface PdfFilePreviewToolbarProps {
  currentPage: number
  isOutlineOpen: boolean
  pageCount: number
  zoomLabel: string
  onJumpToPage: (pageNumber: number) => void
  onNextPage: () => void
  onPreviousPage: () => void
  onResetZoom: () => void
  onToggleOutline: () => void
  onZoomIn: () => void
  onZoomOut: () => void
}

export function PdfFilePreviewToolbar({
  currentPage,
  isOutlineOpen,
  pageCount,
  zoomLabel,
  onJumpToPage,
  onNextPage,
  onPreviousPage,
  onResetZoom,
  onToggleOutline,
  onZoomIn,
  onZoomOut
}: PdfFilePreviewToolbarProps) {
  const { t } = useTranslation()
  const hasPages = pageCount > 0
  const [pageValue, setPageValue] = useState('')

  useEffect(() => {
    setPageValue(hasPages ? String(currentPage) : '')
  }, [currentPage, hasPages])

  const commitPage = () => {
    const pageNumber = Number(pageValue)
    if (Number.isInteger(pageNumber) && pageNumber > 0) {
      onJumpToPage(pageNumber)
      return
    }
    setPageValue(hasPages ? String(currentPage) : '')
  }

  const handlePageSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    commitPage()
  }

  return (
    <FilePreviewToolbar aria-label={t('preview.label')}>
      <FilePreviewToolbarButton
        label={t('file_preview.pdf.outline.title')}
        disabled={!hasPages}
        pressed={isOutlineOpen}
        onClick={onToggleOutline}>
        <ListTree aria-hidden />
      </FilePreviewToolbarButton>
      <span className="mx-1 h-4 w-px bg-border-subtle" aria-hidden />
      <FilePreviewToolbarButton
        label={t('common.previous')}
        disabled={!hasPages || currentPage <= 1}
        onClick={onPreviousPage}>
        <ChevronLeft aria-hidden />
      </FilePreviewToolbarButton>
      <form
        className="flex min-w-16 items-center justify-center gap-1 px-1 text-muted-foreground text-xs tabular-nums"
        data-testid="pdf-preview-page-indicator"
        onSubmit={handlePageSubmit}>
        <span className="sr-only" aria-live="polite">
          {currentPage} / {pageCount}
        </span>
        <Input
          aria-label={t('file_preview.pdf.page_number')}
          className="h-7 w-10 px-1 text-center text-xs tabular-nums"
          disabled={!hasPages}
          inputMode="numeric"
          pattern="[0-9]*"
          value={pageValue}
          onBlur={commitPage}
          onChange={(event) => setPageValue(event.target.value)}
        />
        <span aria-hidden>/</span>
        <span>{pageCount}</span>
      </form>
      <FilePreviewToolbarButton
        label={t('common.next')}
        disabled={!hasPages || currentPage >= pageCount}
        onClick={onNextPage}>
        <ChevronRight aria-hidden />
      </FilePreviewToolbarButton>
      <span className="mx-1 h-4 w-px bg-border-subtle" aria-hidden />
      <FilePreviewToolbarButton label={t('preview.zoom_out')} disabled={!hasPages} onClick={onZoomOut}>
        <ZoomOut aria-hidden />
      </FilePreviewToolbarButton>
      <span
        className="min-w-12 px-1 text-center text-muted-foreground text-xs tabular-nums"
        data-testid="pdf-preview-zoom-value">
        {zoomLabel}
      </span>
      <FilePreviewToolbarButton label={t('preview.zoom_in')} disabled={!hasPages} onClick={onZoomIn}>
        <ZoomIn aria-hidden />
      </FilePreviewToolbarButton>
      <FilePreviewToolbarButton label={t('preview.reset')} disabled={!hasPages} onClick={onResetZoom}>
        <RotateCcw aria-hidden />
      </FilePreviewToolbarButton>
    </FilePreviewToolbar>
  )
}
