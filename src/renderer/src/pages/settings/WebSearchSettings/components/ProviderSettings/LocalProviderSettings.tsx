import { Button } from '@cherrystudio/ui'
import { getProviderWebsites } from '@renderer/config/webSearch'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { ExternalLink } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  provider: WebSearchProvider
}

const LocalProviderSettings: FC<Props> = ({ provider }) => {
  const { t } = useTranslation()
  const websites = getProviderWebsites(provider.id)
  const officialWebsite = websites?.official

  const openLocalProviderSettings = async () => {
    if (officialWebsite) {
      await window.api.searchService.openSearchWindow(provider.id, true)
      await window.api.searchService.openUrlInSearchWindow(provider.id, officialWebsite)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="font-medium text-sm">{t('settings.tool.websearch.local_provider.settings')}</div>
      <Button className="w-50" variant="outline" onClick={openLocalProviderSettings}>
        <ExternalLink className="text-primary" size={14} />
        {t('settings.tool.websearch.local_provider.open_settings', { provider: provider.name })}
      </Button>
      <div className="text-[11px] opacity-40">{t('settings.tool.websearch.local_provider.hint')}</div>
    </div>
  )
}

export default LocalProviderSettings
