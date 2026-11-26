import { useTranslation } from 'react-i18next'

import { Kbd } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

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
      className={cn(
        'pointer-events-none absolute inset-x-0 flex min-w-0 items-center gap-2 text-muted-foreground',
        compact ? 'inset-y-0' : 'top-0'
      )}
      style={{ padding: compact ? undefined : '6px 15px 0', fontSize, lineHeight: 1.4 }}>
      <span className="min-w-0 truncate">{text}</span>
      <span className="flex shrink-0 items-center gap-1 text-xs">
        <Kbd className={cn('bg-muted text-muted-foreground', compact && 'py-0.5')}>Tab</Kbd>
        {t('agent.input.suggestions.accept')}
      </span>
    </div>
  )
}
