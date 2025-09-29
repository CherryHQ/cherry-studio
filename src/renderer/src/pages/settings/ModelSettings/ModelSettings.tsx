import { RedoOutlined } from '@ant-design/icons'
import { Button, InfoTooltip, RowFlex, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ModelSelector from '@renderer/components/ModelSelector'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId, hasModel } from '@renderer/services/ModelService'
import type { Model } from '@renderer/types'
import { TRANSLATE_PROMPT } from '@shared/config/prompts'
import { find } from 'lodash'
import { Languages, MessageSquareMore, Rocket, Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDescription, SettingGroup, SettingTitle } from '..'
import TranslateSettingsPopup from '../TranslateSettingsPopup/TranslateSettingsPopup'
import DefaultAssistantSettings from './DefaultAssistantSettings'
import TopicNamingModalPopup from './QuickModelPopup'

const ModelSettings: FC = () => {
  const { defaultModel, quickModel, translateModel, setDefaultModel, setQuickModel, setTranslateModel } =
    useDefaultModel()
  const { providers } = useProviders()
  const allModels = providers.map((p) => p.models).flat()
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [translateModelPrompt, setTranslateModelPrompt] = usePreference('feature.translate.model_prompt')

  const modelPredicate = useCallback(
    (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m) && !isTextToImageModel(m),
    []
  )

  const defaultModelValue = useMemo(
    () => (hasModel(defaultModel) ? getModelUniqId(defaultModel) : undefined),
    [defaultModel]
  )

  const defaultQuickModel = useMemo(() => (hasModel(quickModel) ? getModelUniqId(quickModel) : undefined), [quickModel])

  const defaultTranslateModel = useMemo(
    () => (hasModel(translateModel) ? getModelUniqId(translateModel) : undefined),
    [translateModel]
  )

  const onResetTranslatePrompt = () => {
    setTranslateModelPrompt(TRANSLATE_PROMPT)
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <RowFlex className="items-center gap-2.5">
            <MessageSquareMore size={18} color="var(--color-text)" />
            {t('settings.models.default_assistant_model')}
          </RowFlex>
        </SettingTitle>
        <RowFlex className="items-center">
          <ModelSelector
            providers={providers}
            predicate={modelPredicate}
            value={defaultModelValue}
            defaultValue={defaultModelValue}
            style={{ width: 360 }}
            onChange={(value) => setDefaultModel(find(allModels, JSON.parse(value)) as Model)}
            placeholder={t('settings.models.empty')}
          />
          <Button
            startContent={<Settings2 size={16} />}
            className="ml-2"
            onPress={DefaultAssistantSettings.show}
            isIconOnly
          />
        </RowFlex>
        <SettingDescription>{t('settings.models.default_assistant_model_description')}</SettingDescription>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <RowFlex className="items-center gap-2.5">
            <Rocket size={18} color="var(--color-text)" />
            {t('settings.models.quick_model.label')}
            <InfoTooltip title={t('settings.models.quick_model.tooltip')} />
          </RowFlex>
        </SettingTitle>
        <RowFlex className="items-center">
          <ModelSelector
            providers={providers}
            predicate={modelPredicate}
            value={defaultQuickModel}
            defaultValue={defaultQuickModel}
            style={{ width: 360 }}
            onChange={(value) => setQuickModel(find(allModels, JSON.parse(value)) as Model)}
            placeholder={t('settings.models.empty')}
          />
          <Button
            startContent={<Settings2 size={16} />}
            className="ml-2"
            onPress={TopicNamingModalPopup.show}
            isIconOnly
          />
        </RowFlex>
        <SettingDescription>{t('settings.models.quick_model.description')}</SettingDescription>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <RowFlex className="items-center gap-2.5">
            <Languages size={18} color="var(--color-text)" />
            {t('settings.models.translate_model')}
          </RowFlex>
        </SettingTitle>
        <RowFlex className="items-center">
          <ModelSelector
            providers={providers}
            predicate={modelPredicate}
            value={defaultTranslateModel}
            defaultValue={defaultTranslateModel}
            style={{ width: 360 }}
            onChange={(value) => setTranslateModel(find(allModels, JSON.parse(value)) as Model)}
            placeholder={t('settings.models.empty')}
          />
          <Button
            startContent={<Settings2 size={16} />}
            isIconOnly
            className="ml-2"
            onPress={() => TranslateSettingsPopup.show()}
          />
          {translateModelPrompt !== TRANSLATE_PROMPT && (
            <Tooltip placement="top" title={t('common.reset')}>
              <Button startContent={<RedoOutlined />} className="ml-2" onPress={onResetTranslatePrompt} isIconOnly />
            </Tooltip>
          )}
        </RowFlex>
        <SettingDescription>{t('settings.models.translate_model_description')}</SettingDescription>
      </SettingGroup>
    </SettingContainer>
  )
}

export default ModelSettings
