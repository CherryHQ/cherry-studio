import { translateText } from '@renderer/services/TranslateService'
import { BUILTIN_LANGUAGE } from '@shared/data/presets/translate-languages'
import type { KeyboardEventHandler } from 'react'
import { useEffect, useRef, useState } from 'react'

interface UsePaintingPromptTranslationOptions {
  prompt?: string
  enabled: boolean
  onTranslated: (translatedText: string) => void
  onError?: (error: unknown) => void
  resetDelayMs?: number
  triggerCount?: number
}

export function usePaintingPromptTranslation({
  prompt,
  enabled,
  onTranslated,
  onError,
  resetDelayMs = 500,
  triggerCount = 3
}: UsePaintingPromptTranslationOptions) {
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const [isTranslating, setIsTranslating] = useState(false)
  const spaceClickTimer = useRef<NodeJS.Timeout | null>(null)

  const translate = async () => {
    if (isTranslating) {
      return
    }

    const promptToTranslate = prompt

    if (!promptToTranslate) {
      return
    }

    try {
      setIsTranslating(true)
      const translatedText = await translateText(promptToTranslate, BUILTIN_LANGUAGE.enUS.langCode)
      onTranslated(translatedText)
    } catch (error) {
      if (onError) {
        onError(error)
        return
      }

      throw error
    } finally {
      setIsTranslating(false)
    }
  }

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (!enabled || event.nativeEvent.isComposing || event.key === 'Process' || event.key !== ' ') {
      return
    }

    const nextSpaceClickCount = spaceClickCount + 1
    setSpaceClickCount(nextSpaceClickCount)

    if (spaceClickTimer.current) {
      clearTimeout(spaceClickTimer.current)
    }

    spaceClickTimer.current = setTimeout(() => {
      setSpaceClickCount(0)
    }, resetDelayMs)

    if (nextSpaceClickCount >= triggerCount) {
      clearTimeout(spaceClickTimer.current)
      spaceClickTimer.current = null
      setSpaceClickCount(0)
      void translate()
    }
  }

  useEffect(() => {
    return () => {
      if (spaceClickTimer.current) {
        clearTimeout(spaceClickTimer.current)
      }
    }
  }, [])

  return {
    isTranslating,
    handleKeyDown
  }
}
