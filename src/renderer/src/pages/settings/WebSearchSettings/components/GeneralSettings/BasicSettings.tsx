import { InfoTooltip, Slider, Switch } from '@cherrystudio/ui'
import { useBasicWebSearchSettings, useCompressionMethod } from '@renderer/hooks/useWebSearch'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const BasicSettings: FC = () => {
  const { t } = useTranslation()
  const { searchWithTime, maxResults, setSearchWithTime, setMaxResults } = useBasicWebSearchSettings()
  const { method: compressionMethod } = useCompressionMethod()

  return (
    <div className="flex flex-col gap-2 px-4 py-2">
      <div>{t('settings.general.title')}</div>
      <div className="border-border border-b" />
      <div className="flex flex-row items-center justify-between">
        <div>{t('settings.tool.websearch.search_with_time')}</div>
        <Switch checked={searchWithTime} onCheckedChange={(checked) => setSearchWithTime(checked)} />
      </div>
      <div className="border-border border-b" />

      <div className="flex flex-row items-center justify-between">
        <div className="flex flex-row items-center justify-center gap-1">
          {t('settings.tool.websearch.search_max_result.label')}
          {maxResults > 20 && compressionMethod === 'none' && (
            <InfoTooltip
              placement="right"
              content={t('settings.tool.websearch.search_max_result.tooltip')}
              iconProps={{ size: 16, color: 'var(--color-icon)', className: 'ml-1 cursor-pointer' }}
            />
          )}
        </div>
        <Slider
          defaultValue={[maxResults]}
          className="w-1/3 px-3"
          min={1}
          max={100}
          showValueLabel
          step={1}
          marks={[
            { value: 1, label: '1' },
            { value: 20, label: '20' },
            { value: 50, label: '50' },
            { value: 100, label: '100' }
          ]}
          onValueChange={(values) => setMaxResults(values[0])}
        />
      </div>
    </div>
  )
}

export default BasicSettings
