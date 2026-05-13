import Selector from '@renderer/components/Selector'
import { SettingRow } from '@renderer/pages/settings'
import type { RootState } from '@renderer/store'
import { useAppDispatch } from '@renderer/store'
import { setOpenAIStreamOptionsIncludeUsage } from '@renderer/store/settings'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import type { OpenAICompletionsStreamOptions } from '@shared/types/aiSdk'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

type IncludeUsageOption = {
  value: 'undefined' | 'false' | 'true'
  label: string
}

interface Props {
  SettingRowTitleSmall: FC<{ children: React.ReactNode; hint?: string }>
}

const StreamOptionsSetting: FC<Props> = ({ SettingRowTitleSmall }) => {
  const { t } = useTranslation()
  const includeUsage = useSelector((state: RootState) => state.settings.openAI?.streamOptions?.includeUsage)
  const dispatch = useAppDispatch()

  const setIncludeUsage = useCallback(
    (value: OpenAICompletionsStreamOptions['include_usage']) => {
      dispatch(setOpenAIStreamOptionsIncludeUsage(value))
    },
    [dispatch]
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
      <SettingRowTitleSmall hint={t('settings.openai.stream_options.include_usage.tip')}>
        {t('settings.openai.stream_options.include_usage.title')}
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
