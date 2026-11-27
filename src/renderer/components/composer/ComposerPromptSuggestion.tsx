import { useTranslation } from 'react-i18next'

import { Kbd } from '@cherrystudio/ui'

export function ComposerPromptSuggestion({
  text,
  fontSize,
  compact = false
}: {
  text: string
  fontSize: number
  compact?: boolean
}) {
  const { t } = useTranslation()
  if (!text) return null
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 flex min-w-0 items-center gap-2 text-muted-foreground"
      style={{ padding: compact ? '3px 0' : '6px 15px 0', fontSize, lineHeight: 1.4 }}>
      <span className="min-w-0 truncate">{text}</span>
      <span className="flex shrink-0 items-center gap-1 text-xs">
        <Kbd className="bg-muted text-muted-foreground">Tab</Kbd>
        {t('agent.input.suggestions.accept')}
      </span>
    </div>
  )
}
