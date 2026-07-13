import { Button, Input, Tooltip } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useTimer } from '@renderer/hooks/useTimer'
import type { Model } from '@shared/data/types/model'
import { PictureInPicture2 } from 'lucide-react'
import React, { useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface InputBarProps {
  text: string
  model?: Model
  referenceText: string
  placeholder: string
  loading: boolean
  onRestoreMain?: () => void
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

const InputBar = ({
  ref,
  text,
  model,
  placeholder,
  loading,
  onRestoreMain,
  handleKeyDown,
  handleChange
}: InputBarProps & { ref?: React.RefObject<HTMLDivElement | null> }) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const { setTimeoutTimer } = useTimer()
  const { t } = useTranslation()
  if (!loading) {
    setTimeoutTimer('focus', () => inputRef.current?.focus(), 0)
  }
  return (
    <div ref={ref} className="mt-2.5 flex items-center gap-2">
      {model && <ModelAvatar model={model} size={30} />}
      <Input
        ref={inputRef}
        value={text}
        placeholder={placeholder}
        autoFocus
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-lg shadow-none [-webkit-app-region:no-drag] placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
      />
      {onRestoreMain && (
        <Tooltip placement="bottom" content={t('quickAssistant.tooltip.restore_main')} delay={800}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('quickAssistant.tooltip.restore_main')}
            onClick={onRestoreMain}
            className="nodrag h-8 w-8 shrink-0 rounded-[8px] text-foreground-secondary">
            <PictureInPicture2 size={16} strokeWidth={1.8} />
          </Button>
        </Tooltip>
      )}
    </div>
  )
}
InputBar.displayName = 'InputBar'

export default InputBar
