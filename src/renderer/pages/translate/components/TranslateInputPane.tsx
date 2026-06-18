import { Button } from '@cherrystudio/ui'
import uploadExcelIcon from '@renderer/assets/images/translate/upload-excel.svg'
import uploadImageIcon from '@renderer/assets/images/translate/upload-image.svg'
import uploadPdfIcon from '@renderer/assets/images/translate/upload-pdf.svg'
import uploadPptIcon from '@renderer/assets/images/translate/upload-ppt.svg'
import uploadTextIcon from '@renderer/assets/images/translate/upload-text.svg'
import uploadWordIcon from '@renderer/assets/images/translate/upload-word.svg'
import { useDrag } from '@renderer/hooks/useDrag'
import { Copy, LoaderCircle, X } from 'lucide-react'
import type { KeyboardEvent, Ref, UIEvent } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import IconButton from './IconButton'

type Props = {
  ref?: Ref<HTMLTextAreaElement>
  text: string
  onTextChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onScroll: (event: UIEvent<HTMLTextAreaElement>) => void
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
  onSelectFile: () => void
  onCopy: () => void
  onCancelOcr: () => void
  disabled: boolean
  ocrProcessing: boolean
  selecting: boolean
}

const TranslateInputPane = ({
  ref,
  text,
  onTextChange,
  onKeyDown,
  onScroll,
  onPaste,
  onDrop,
  onSelectFile,
  onCopy,
  onCancelOcr,
  disabled,
  ocrProcessing,
  selecting
}: Props) => {
  const { t } = useTranslation()

  const {
    isDragging,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop: handleDropEvent
  } = useDrag<HTMLDivElement>(onDrop)

  const handleClear = useCallback(() => {
    onTextChange('')
  }, [onTextChange])

  const uploadIcons = [uploadImageIcon, uploadPdfIcon, uploadWordIcon, uploadPptIcon, uploadTextIcon, uploadExcelIcon]

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDropEvent}>
      <div className="relative min-h-0 flex-1">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={onScroll}
          onPaste={onPaste}
          disabled={disabled}
          spellCheck={false}
          placeholder={t('translate.input.placeholder')}
          className="h-full w-full resize-none bg-transparent p-4 pe-12 text-base text-foreground leading-relaxed outline-none placeholder:font-normal placeholder:text-foreground-muted"
        />
        <IconButton
          size="sm"
          onClick={onCopy}
          disabled={!text}
          aria-label={t('common.copy')}
          className="absolute end-3 top-4">
          <Copy size={14} />
        </IconButton>
      </div>
      {!text && (
        <button
          type="button"
          onClick={onSelectFile}
          disabled={disabled || selecting}
          aria-label={t('translate.files.upload')}
          className="mx-3 mb-4 flex shrink-0 flex-col items-center justify-center gap-3 rounded-md border border-border-muted border-dashed px-4 py-4 text-foreground-muted transition-colors hover:border-border-hover hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60">
          <span className="text-sm">{t('translate.files.upload')}</span>
          <span className="flex items-center gap-6">
            {uploadIcons.map((icon) => (
              <img key={icon} src={icon} alt="" aria-hidden="true" className="size-7" />
            ))}
          </span>
        </button>
      )}
      {text && !disabled && (
        <div className="flex shrink-0 items-center px-3 py-3">
          <button
            type="button"
            onClick={handleClear}
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-foreground-muted text-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <X size={14} className="lucide-custom" />
            <span>{t('common.clear')}</span>
          </button>
        </div>
      )}
      {isDragging && (
        <div className="fade-in-0 pointer-events-none absolute inset-0 z-10 flex animate-in items-center justify-center bg-background p-3 duration-150">
          <div className="flex h-full w-full items-center justify-center rounded-md border border-border-muted border-dashed">
            {/* Drawn as a single path so the translucent foreground token paints
                evenly: lucide's Plus uses two crossing paths, which composites
                the alpha twice and darkens the center. */}
            <svg
              width={40}
              height={40}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="text-foreground-secondary"
              aria-hidden="true">
              <path d="M5 12h14M12 5v14" />
            </svg>
            <span className="sr-only">{t('translate.files.drag_text')}</span>
          </div>
        </div>
      )}
      {ocrProcessing && (
        <div className="fade-in-0 absolute inset-0 z-20 flex animate-in items-center justify-center bg-background/90 p-3 duration-150">
          <div className="flex flex-col items-center gap-3">
            <div role="status" aria-live="polite" className="flex items-center gap-2 text-foreground-muted text-sm">
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
              <span>{t('ocr.processing')}</span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => onCancelOcr()}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default TranslateInputPane
