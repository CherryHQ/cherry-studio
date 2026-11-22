import { useTranslation } from 'react-i18next'

import { Badge } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { parseSkillSourceUrl } from '@shared/utils/skillMarketplace'

const SOURCE_LABEL_KEYS: ReadonlyMap<string, string> = new Map([
  ['builtin', 'settings.skills.source.builtin'],
  ['local', 'settings.skills.source.local'],
  ['marketplace', 'settings.skills.source.marketplace'],
  ['system', 'settings.skills.source.system'],
  ['zip', 'settings.skills.source.zip']
])

export function SkillSourceBadge({
  source,
  sourceUrl,
  className
}: {
  source: string
  sourceUrl?: string | null
  className?: string
}) {
  const { t } = useTranslation()
  const labelKey = SOURCE_LABEL_KEYS.get(source)
  const label = labelKey ? t(labelKey) : source
  const sourceRegistry = source === 'marketplace' && sourceUrl ? parseSkillSourceUrl(sourceUrl)?.sourceRegistry : null

  return (
    <Badge
      variant="secondary"
      className={cn(
        'shrink-0 border-0 bg-info-subtle px-1.5 py-px font-normal text-info-subtle-foreground text-xs',
        className
      )}>
      {source === 'marketplace' && sourceRegistry ? `${label} · ${sourceRegistry}` : label}
    </Badge>
  )
}
