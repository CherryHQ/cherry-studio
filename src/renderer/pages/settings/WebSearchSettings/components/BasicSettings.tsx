import { Button, InfoTooltip, InputNumber, Tooltip } from '@cherrystudio/ui'
import ResetIcon from '@renderer/components/icons/ResetIcon'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebSearchPersist } from '../hooks/useWebSearchPersist'
import { CompressionSettings } from './CompressionSettings'

const settingRowClassName = 'min-h-8 items-center justify-between gap-3'
const settingLabelClassName = 'min-w-0 flex-1'
const DEFAULT_MAX_RESULTS = 5

interface Props {
  variant?: 'card' | 'plain'
}

const BasicSettings: FC<Props> = ({ variant = 'card' }) => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { maxResults, compressionConfig, setMaxResults } = useWebSearchSettings()
  const isMaxResultsDefault = maxResults === DEFAULT_MAX_RESULTS
  const persist = useWebSearchPersist()

  // `onBlur` fires once per edit with the normalized value, so the field needs
  // no local draft: a failed save leaves the saved value shown.
  const commitMaxResults = (value: number | null) => {
    const next = value === null ? 1 : Math.min(100, Math.max(1, Math.trunc(value)))
    if (next === maxResults) {
      return
    }
    void persist(() => setMaxResults(next), 'Failed to save web search max results')
  }

  const resetMaxResults = () => {
    void persist(() => setMaxResults(DEFAULT_MAX_RESULTS), 'Failed to reset web search max results')
  }

  return (
    <SettingGroup theme={theme} variant={variant} style={{ paddingBottom: 8 }}>
      {variant === 'card' ? (
        <>
          <SettingTitle>{t('settings.general.label')}</SettingTitle>
          <SettingDivider />
        </>
      ) : null}
      {variant === 'plain' ? <SettingDivider className="mt-0 border-border-subtle" /> : null}
      <div className="flex flex-col">
        <SettingRow className={settingRowClassName}>
          <SettingRowTitle className={settingLabelClassName}>
            {t('settings.tool.websearch.search_max_result.label')}
            {maxResults > 20 && compressionConfig?.method === 'none' && (
              <InfoTooltip
                content={t('settings.tool.websearch.search_max_result.tooltip')}
                iconProps={{ size: 16, color: 'var(--muted-foreground)', className: 'ml-1 cursor-pointer' }}
              />
            )}
          </SettingRowTitle>
          <div className="flex shrink-0 items-center justify-end gap-2">
            {!isMaxResultsDefault && (
              <Tooltip content={t('common.reset')}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={t('common.reset')}
                  onClick={resetMaxResults}>
                  <ResetIcon size={14} />
                </Button>
              </Tooltip>
            )}
            <InputNumber
              aria-label={t('settings.tool.websearch.search_max_result.label')}
              min={1}
              max={100}
              step={1}
              value={maxResults}
              className="h-8 w-20 text-center text-sm"
              onBlur={commitMaxResults}
            />
          </div>
        </SettingRow>
        <SettingDivider className="border-border-subtle" />
        <CompressionSettings />
      </div>
    </SettingGroup>
  )
}

export default BasicSettings
