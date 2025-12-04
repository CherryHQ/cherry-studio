import Selector from '@renderer/components/Selector'
import { getModelSupportedVerbosity } from '@renderer/config/models'
import { SettingRow } from '@renderer/pages/settings'
import type { RootState } from '@renderer/store'
import { useAppDispatch } from '@renderer/store'
import { setOpenAIVerbosity } from '@renderer/store/settings'
import type { Model } from '@renderer/types'
import type { OpenAIVerbosity } from '@renderer/types/aiCoreTypes'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import { Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

type VerbosityOption = {
  value: NonNullable<OpenAIVerbosity> | 'undefined' | 'null'
  label: string
}

interface Props {
  model: Model
  SettingRowTitleSmall: FC<{ children: React.ReactNode }>
}

const VerbositySetting: FC<Props> = ({ model, SettingRowTitleSmall }) => {
  const { t } = useTranslation()
  const verbosity = useSelector((state: RootState) => state.settings.openAI.verbosity)
  const dispatch = useAppDispatch()

  const setVerbosity = useCallback(
    (value: OpenAIVerbosity) => {
      dispatch(setOpenAIVerbosity(value))
    },
    [dispatch]
  )

  const verbosityOptions = useMemo(() => {
    const allOptions = [
      {
        value: 'undefined',
        label: t('common.ignore')
      },
      {
        value: 'null',
        label: t('common.off')
      },
      {
        value: 'low',
        label: t('settings.openai.verbosity.low')
      },
      {
        value: 'medium',
        label: t('settings.openai.verbosity.medium')
      },
      {
        value: 'high',
        label: t('settings.openai.verbosity.high')
      }
    ] as const satisfies VerbosityOption[]
    const supportedVerbosityLevels = getModelSupportedVerbosity(model).map((v) => toOptionValue(v))
    return allOptions.filter((option) => supportedVerbosityLevels.includes(option.value))
  }, [model, t])

  useEffect(() => {
    if (verbosity && !verbosityOptions.some((option) => option.value === verbosity)) {
      const supportedVerbosityLevels = getModelSupportedVerbosity(model)
      // Default to the highest supported verbosity level
      const defaultVerbosity = supportedVerbosityLevels[supportedVerbosityLevels.length - 1]
      setVerbosity(defaultVerbosity)
    }
  }, [model, verbosity, verbosityOptions, setVerbosity])

  return (
    <SettingRow>
      <SettingRowTitleSmall>
        {t('settings.openai.verbosity.title')}{' '}
        <Tooltip title={t('settings.openai.verbosity.tip')}>
          <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
        </Tooltip>
      </SettingRowTitleSmall>
      <Selector
        value={toOptionValue(verbosity)}
        onChange={(value) => {
          setVerbosity(toRealValue(value))
        }}
        options={verbosityOptions}
      />
    </SettingRow>
  )
}

export default VerbositySetting
