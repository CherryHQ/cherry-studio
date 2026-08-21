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
import { useEffect, useState } from 'react'
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
  const [draftMaxResults, setDraftMaxResults] = useState<number | null>(maxResults)
  const [maxResultsBaseline, setMaxResultsBaseline] = useState(maxResults)
  const maxResultsDirty = draftMaxResults !== maxResultsBaseline
  const isMaxResultsDefault = maxResultsBaseline === DEFAULT_MAX_RESULTS && draftMaxResults === DEFAULT_MAX_RESULTS
  const persist = useWebSearchPersist()

  useEffect(() => {
    if (!maxResultsDirty) {
      setDraftMaxResults(maxResults)
    }
    setMaxResultsBaseline(maxResults)
  }, [maxResults, maxResultsDirty])

  const commitMaxResultsDraft = () => {
    if (!maxResultsDirty) {
      return
    }

    const nextMaxResults = draftMaxResults === null ? 1 : Math.min(100, Math.max(1, Math.trunc(draftMaxResults)))

    void persist(() => setMaxResults(nextMaxResults), 'Failed to save web search max results').then((result) => {
      if (result.ok) {
        setDraftMaxResults(nextMaxResults)
        setMaxResultsBaseline(nextMaxResults)
      }
    })
  }

  const resetMaxResults = () => {
    void persist(() => setMaxResults(DEFAULT_MAX_RESULTS), 'Failed to reset web search max results').then((result) => {
      if (result.ok) {
        setDraftMaxResults(DEFAULT_MAX_RESULTS)
        setMaxResultsBaseline(DEFAULT_MAX_RESULTS)
      }
    })
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
                  onMouseDown={(e) => e.preventDefault()}
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
              value={draftMaxResults}
              className="h-8 w-20 text-center text-sm"
              onChange={setDraftMaxResults}
              onBlur={commitMaxResultsDraft}
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
