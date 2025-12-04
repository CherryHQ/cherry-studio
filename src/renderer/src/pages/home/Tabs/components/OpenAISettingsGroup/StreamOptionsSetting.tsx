import Selector from '@renderer/components/Selector'
import { useProvider } from '@renderer/hooks/useProvider'
import { SettingRow } from '@renderer/pages/settings'
import type { OpenAICompletionsStreamOptions } from '@renderer/types/aiCoreTypes'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import { Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type IncludeUsageOption = {
  value: 'undefined' | 'false' | 'true'
  label: string
}

interface Props {
  providerId: string
  SettingRowTitleSmall: FC<{ children: React.ReactNode }>
}

const StreamOptionsSetting: FC<Props> = ({ providerId, SettingRowTitleSmall }) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)
  const includeUsage = provider.streamOptions?.includeUsage

  const setIncludeUsage = useCallback(
    (value: OpenAICompletionsStreamOptions['include_usage']) => {
      updateProvider({
        streamOptions: {
          includeUsage: value
        }
      })
    },
    [updateProvider]
  )

  const includeUsageOptions = useMemo(() => {
    return [
      {
        value: 'undefined',
        label: t('common.ignore')
      },
      {
        value: 'false',
        label: t('common.off')
      },
      {
        value: 'true',
        label: t('common.on')
      }
    ] as const satisfies IncludeUsageOption[]
  }, [t])

  return (
    <SettingRow>
      <SettingRowTitleSmall>
        {t('settings.openai.stream_options.include_usage.title')}{' '}
        <Tooltip title={t('settings.openai.stream_options.include_usage.tip')}>
          <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
        </Tooltip>
      </SettingRowTitleSmall>
      <Selector
        value={toOptionValue(includeUsage)}
        onChange={(value) => {
          setIncludeUsage(toRealValue(value))
        }}
        options={includeUsageOptions}
      />
    </SettingRow>
  )
}

export default StreamOptionsSetting
