import { InfoTooltip, Slider, Switch } from '@cherrystudio/ui'
import { Divider } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebSearchSettings } from '../hooks/useWebSearchSettings'
import { WebSearchSettingsField, WebSearchSettingsHint, WebSearchSettingsSection } from './WebSearchSettingsLayout'

const BasicSettings: FC = () => {
  const { t } = useTranslation()
  const { compressionConfig, maxResults, searchWithTime, setMaxResults, setSearchWithTime } = useWebSearchSettings()
  const [maxResultsValue, setMaxResultsValue] = useState(maxResults)

  useEffect(() => {
    setMaxResultsValue(maxResults)
  }, [maxResults])

  return (
    <WebSearchSettingsSection title={t('settings.general.title')}>
      <WebSearchSettingsField title={t('settings.tool.websearch.search_with_time')}>
        <Switch checked={searchWithTime} onCheckedChange={setSearchWithTime} />
      </WebSearchSettingsField>
      <Divider className="my-0" />
      <WebSearchSettingsField
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
        <div className="space-y-2">
          <Slider
            min={1}
            max={100}
            step={1}
            value={[maxResultsValue]}
            onValueChange={([value]) => setMaxResultsValue(value)}
            onValueCommit={([value]) => void setMaxResults(value)}
            marks={[
              { value: 1, label: '1' },
              { value: 5, label: '5' },
              { value: 20, label: '20' },
              { value: 50, label: '50' },
              { value: 100, label: '100' }
            ]}
            showValueLabel
          />
          <WebSearchSettingsHint>
            {t('settings.tool.websearch.search_max_result.label') + `: ${maxResultsValue}`}
          </WebSearchSettingsHint>
        </div>
      </WebSearchSettingsField>
    </WebSearchSettingsSection>
  )
}

export default BasicSettings
