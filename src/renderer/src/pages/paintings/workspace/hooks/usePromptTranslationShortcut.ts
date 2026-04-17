import { usePreference } from '@data/hooks/usePreference'
import { useCallback, useEffect, useRef, useState } from 'react'

import { translatePaintingPrompt } from '../../model/services/paintingTranslationService'

interface UsePromptTranslationShortcutOptions {
  prompt?: string
  onTranslated: (translated: string) => void
}

export function usePromptTranslationShortcut({ prompt, onTranslated }: UsePromptTranslationShortcutOptions) {
  const [autoTranslateWithSpace] = usePreference('chat.input.translate.auto_translate_with_space')
  const [isTranslating, setIsTranslating] = useState(false)
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const spaceClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const translate = useCallback(async () => {
    if (isTranslating || !prompt) return

    try {
      setIsTranslating(true)
      const translatedText = await translatePaintingPrompt(prompt)
      onTranslated(translatedText)
    } finally {
      setIsTranslating(false)
    }
  }, [isTranslating, onTranslated, prompt])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (autoTranslateWithSpace && event.key === ' ') {
        setSpaceClickCount((prev) => prev + 1)

        if (spaceClickTimer.current) {
          clearTimeout(spaceClickTimer.current)
        }

        spaceClickTimer.current = setTimeout(() => {
          setSpaceClickCount(0)
        }, 200)

        if (spaceClickCount === 2) {
          setSpaceClickCount(0)
          void translate()
        }
      }
    },
    [autoTranslateWithSpace, spaceClickCount, translate]
  )

  useEffect(() => {
    return () => {
      if (spaceClickTimer.current) {
        clearTimeout(spaceClickTimer.current)
      }
    }
  }, [])

  return {
    isTranslating,
    translate,
    handleKeyDown
  }
}
