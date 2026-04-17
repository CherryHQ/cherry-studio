import { useDrag } from '@renderer/hooks/useDrag'
import { cn } from '@renderer/utils'
import { Copy, FileUp, UploadIcon, X } from 'lucide-react'
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
  disabled: boolean
  selecting: boolean
  tokenCount: number
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
  disabled,
  selecting,
  tokenCount
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

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className={cn('relative min-h-0 flex-1', isDragging && 'bg-accent ring-2 ring-ring/50')}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDropEvent}>
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-foreground-secondary">
            <UploadIcon size={22} />
            <span className="text-xs">{t('translate.files.drag_text')}</span>
          </div>
        )}
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
          className="h-full w-full resize-none bg-transparent px-4 py-3 text-[13px] text-foreground leading-relaxed outline-none placeholder:text-foreground-muted"
        />
        {text && !disabled && (
          <IconButton
            size="sm"
            onClick={handleClear}
            aria-label={t('common.clear')}
            className="absolute top-2.5 right-2.5">
            <X size={12} />
          </IconButton>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-0.5">
          <IconButton size="md" onClick={onSelectFile} disabled={selecting} aria-label={t('common.upload_files')}>
            <FileUp size={12} />
          </IconButton>
          <IconButton size="md" onClick={onCopy} disabled={!text} aria-label={t('common.copy')}>
            <Copy size={12} />
          </IconButton>
        </div>
        <span className="text-[10px] text-foreground-muted">{tokenCount}</span>
      </div>
    </div>
  )
}

export default TranslateInputPane
