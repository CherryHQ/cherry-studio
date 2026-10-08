import { Volume2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { readTextAloud } from '@renderer/services/voice'

export function ResultReadAloudButton({ text, sourceEntityId }: { text: string; sourceEntityId: string }) {
  const { t } = useTranslation()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const currentTextRef = useRef(text)
  currentTextRef.current = text
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="sm"
      className="h-[22px] min-h-0 min-w-0 shrink gap-1.5 rounded bg-muted px-2 text-muted-foreground hover:bg-muted hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground"
      aria-label={t('selection.action.voice.read_result')}
      onClick={() =>
        void readTextAloud({
          text,
          mode: 'document',
          sourceLabel: 'preview',
          sourceEntityId,
          isCurrent: () => mountedRef.current && currentTextRef.current === text,
          focusOnClose: () => buttonRef.current?.focus()
        })
      }>
      <Volume2 className="size-3.5" />
      <span className="truncate">{t('selection.action.voice.read_result')}</span>
    </Button>
  )
}
