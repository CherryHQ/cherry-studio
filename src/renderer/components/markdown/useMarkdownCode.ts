import { useMemo, type ReactNode } from 'react'
import { useIsCodeFenceIncomplete } from 'streamdown'

import { getNodeText } from '@renderer/utils/reactNodeText'

export const INLINE_CODE_CLASS =
  'whitespace-pre-wrap! break-words! rounded-[5px] px-1! py-0.5! text-[0.95em]! leading-normal'

export function useMarkdownCode(children: ReactNode, className?: string, sourceFormat: 'hast' | 'raw' = 'hast') {
  const text = getNodeText(children)
  const detectedLanguage = /language-([\w-+]+)/.exec(className || '')?.[1] ?? (text.includes('\n') ? 'text' : null)
  const language = useMemo(
    () =>
      detectedLanguage === 'xml' && /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(text) ? 'svg' : detectedLanguage,
    [text, detectedLanguage]
  )
  const isIncomplete = useIsCodeFenceIncomplete()
  // mdast-util-to-hast appends one structural LF to non-empty fenced code.
  const source = sourceFormat === 'hast' && language !== null && text.endsWith('\n') ? text.slice(0, -1) : text
  return { text: source, language, isIncomplete }
}
