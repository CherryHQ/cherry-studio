import { HStack } from '@renderer/components/Layout'
import ModelSelector from '@renderer/components/ModelSelector'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId, hasModel } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { find } from 'lodash'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDescription, SettingGroup, SettingTitle } from '..'

const TranslateModelSettings = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { providers } = useProviders()
  const { translateModel, setTranslateModel } = useDefaultModel()

  const allModels = useMemo(() => providers.map((p) => p.models).flat(), [providers])

  const modelPredicate = useCallback(
    (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m) && !isTextToImageModel(m),
    []
  )

  const defaultTranslateModel = useMemo(
    () => (hasModel(translateModel) ? getModelUniqId(translateModel) : undefined),
    [translateModel]
  )

  return (
    <SettingGroup theme={theme}>
      <SettingTitle style={{ marginBottom: 12 }}>
        <HStack alignItems="center" gap={10}>
          {t('settings.models.translate_model')}
        </HStack>
      </SettingTitle>
      <HStack alignItems="center">
        <ModelSelector
          providers={providers}
          predicate={modelPredicate}
          value={defaultTranslateModel}
          defaultValue={defaultTranslateModel}
          style={{ width: 360 }}
          onChange={(value) => setTranslateModel(find(allModels, JSON.parse(value)) as Model)}
          placeholder={t('settings.models.empty')}
        />
      </HStack>
      <SettingDescription>{t('settings.models.translate_model_description')}</SettingDescription>
    </SettingGroup>
  )
}

export default TranslateModelSettings
