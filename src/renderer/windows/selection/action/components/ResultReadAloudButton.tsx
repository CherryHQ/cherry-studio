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
      <Volume2 className="size-4" />
      {t('selection.action.voice.read_result')}
    </Button>
  )
}
