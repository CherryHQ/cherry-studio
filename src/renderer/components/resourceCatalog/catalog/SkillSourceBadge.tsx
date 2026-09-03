import { Badge } from '@cherrystudio/ui'
import { parseSkillSourceUrl } from '@shared/utils/skillMarketplace'
import { useTranslation } from 'react-i18next'

const SOURCE_LABEL_KEYS: Record<string, string> = {
  builtin: 'settings.skills.source.builtin',
  local: 'settings.skills.source.local',
  marketplace: 'settings.skills.source.marketplace',
  system: 'settings.skills.source.system',
  zip: 'settings.skills.source.zip'
}

export function SkillSourceBadge({ source, sourceUrl }: { source: string; sourceUrl?: string | null }) {
  const { t } = useTranslation()
  const labelKey = SOURCE_LABEL_KEYS[source]
  const label = labelKey ? t(labelKey) : source
  const sourceRegistry = source === 'marketplace' && sourceUrl ? parseSkillSourceUrl(sourceUrl)?.sourceRegistry : null

  return (
    <Badge
      variant="secondary"
      className="shrink-0 border-0 bg-info-subtle px-1.5 py-px font-normal text-info-subtle-foreground text-xs">
      {source === 'marketplace' && sourceRegistry ? `${label} · ${sourceRegistry}` : label}
    </Badge>
  )
}
