import { Textarea } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import SendMessageButton from '@renderer/pages/home/Inputbar/SendMessageButton'
import { type FC, type KeyboardEventHandler, type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { PaintingData } from '../model/types/paintingData'
import { resolvePaintingProviderDefinition } from '../utils/paintingProviderMode'

interface PaintingPromptBarProps {
  painting: PaintingData
  generating: boolean
  leadingActions?: ReactNode
  onPromptChange: (value: string) => void
  onGenerate: () => void
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>
}

const PaintingPromptBar: FC<PaintingPromptBarProps> = ({
  painting,
  generating,
  leadingActions,
  onPromptChange,
  onGenerate,
  onKeyDown
}) => {
  const { t } = useTranslation()
  const definition = useMemo(() => resolvePaintingProviderDefinition(painting.providerId), [painting.providerId])
  const placeholder = definition.prompt?.placeholder?.({ painting }) ?? t('paintings.prompt_placeholder')
  const disabled = definition.prompt?.disabled?.({ painting, isLoading: generating }) ?? generating

  return (
    <div className="flex w-full min-w-0 shrink-0 px-2 pt-2 pb-4">
      <div className="relative flex h-[110px] w-full min-w-0 flex-col rounded-[1.25rem] border border-border/60 bg-white dark:bg-background">
        <Textarea.Input
          disabled={disabled}
          value={painting.prompt || ''}
          spellCheck={false}
          className={cn(
            'flex-1 resize-none border-0 bg-transparent px-4 pt-3 pb-1.5 text-foreground/85 text-sm shadow-none',
            'placeholder:text-muted-foreground/55 focus-visible:ring-0'
          )}
          placeholder={placeholder}
          onValueChange={onPromptChange}
          onKeyDown={onKeyDown}
        />
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3.5 pt-2 pb-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{leadingActions}</div>
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <SendMessageButton sendMessage={onGenerate} disabled={disabled} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default PaintingPromptBar
