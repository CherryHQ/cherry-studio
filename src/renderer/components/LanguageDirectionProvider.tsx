import { DirectionProvider } from '@cherrystudio/ui'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'
import { syncDocumentLanguage } from '@renderer/i18n/languages'
import { getLanguageDirection } from '@shared/utils/languages'
import type { PropsWithChildren } from 'react'
import { useLayoutEffect } from 'react'

export function LanguageDirectionProvider({ children }: PropsWithChildren): React.ReactElement {
  const language = useLanguageSync()
  const direction = getLanguageDirection(language)

  useLayoutEffect(() => {
    syncDocumentLanguage(language)
  }, [language])

  return <DirectionProvider dir={direction}>{children}</DirectionProvider>
}
