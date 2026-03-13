import { InfoTooltip, Slider, Switch } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebSearchSettings } from '../hooks/useWebSearchSettings'
import { WebSearchSettingsBadge, WebSearchSettingsField, WebSearchSettingsSection } from './WebSearchSettingsLayout'

const BasicSettings: FC = () => {
  const { t } = useTranslation()
  const { compressionConfig, maxResults, searchWithTime, setMaxResults, setSearchWithTime } = useWebSearchSettings()
  const [maxResultsValue, setMaxResultsValue] = useState(maxResults)

  useEffect(() => {
    setMaxResultsValue(maxResults)
  }, [maxResults])

  return (
    <WebSearchSettingsSection title={t('settings.general.title')}>
      <WebSearchSettingsField
        meta={<WebSearchSettingsBadge>{maxResultsValue}</WebSearchSettingsBadge>}
        title={
          <>
            {t('settings.tool.websearch.search_max_result.label')}
            {maxResults > 20 && compressionConfig?.method === 'none' && (
              <InfoTooltip
                content={t('settings.tool.websearch.search_max_result.tooltip')}
                iconProps={{ size: 16, color: 'var(--color-icon)', className: 'cursor-pointer' }}
              />
            )}
          </>
        }>
        <div className="flex items-center gap-2.5">
          <span className="w-3 shrink-0 text-right text-[9px] text-foreground">1</span>
          <div className="flex-1">
            <Slider
              size="sm"
              min={1}
              max={100}
              step={1}
              value={[maxResultsValue]}
              onValueChange={([value]) => setMaxResultsValue(value)}
              onValueCommit={([value]) => void setMaxResults(value)}
            />
          </div>
          <span className="w-6 shrink-0 text-[9px] text-foreground">100</span>
        </div>
      </WebSearchSettingsField>
      <WebSearchSettingsField layout="inline" title={t('settings.tool.websearch.search_with_time')}>
        <Switch
          checked={searchWithTime}
          onCheckedChange={setSearchWithTime}
          className="data-[state=checked]:bg-emerald-500"
        />
      </WebSearchSettingsField>
    </WebSearchSettingsSection>
  )
}

export default BasicSettings
