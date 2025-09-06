import { RedoOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import ModelSelector from '@renderer/components/ModelSelector'
import { InfoTooltip } from '@renderer/components/TooltipIcons'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { TRANSLATE_PROMPT } from '@renderer/config/prompts'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { getModelUniqId, hasModel } from '@renderer/services/ModelService'
import { useAppDispatch } from '@renderer/store'
import { setTranslateModelPrompt } from '@renderer/store/settings'
import { Model } from '@renderer/types'
import { Button, Tooltip } from 'antd'
import { find } from 'lodash'
import { Languages, MessageSquareMore, Rocket, Settings2 } from 'lucide-react'
import { FC, useCallback, useMemo } from 'react'
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
  const { translateModelPrompt } = useSettings()

  const dispatch = useAppDispatch()

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
    dispatch(setTranslateModelPrompt(TRANSLATE_PROMPT))
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <HStack alignItems="center" gap={10}>
            <MessageSquareMore size={18} color="var(--color-text)" />
            {t('settings.models.default_assistant_model')}
          </HStack>
        </SettingTitle>
        <HStack alignItems="center">
          <ModelSelector
            providers={providers}
            predicate={modelPredicate}
            value={defaultModelValue}
            defaultValue={defaultModelValue}
            style={{ width: 360 }}
            onChange={(value) => setDefaultModel(find(allModels, JSON.parse(value)) as Model)}
            placeholder={t('settings.models.empty')}
          />
          <Button icon={<Settings2 size={16} />} style={{ marginLeft: 8 }} onClick={DefaultAssistantSettings.show} />
        </HStack>
        <SettingDescription>{t('settings.models.default_assistant_model_description')}</SettingDescription>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <HStack alignItems="center" gap={10}>
            <Rocket size={18} color="var(--color-text)" />
            {t('settings.models.quick_model.label')}
            <InfoTooltip title={t('settings.models.quick_model.tooltip')} />
          </HStack>
        </SettingTitle>
        <HStack alignItems="center">
          <ModelSelector
            providers={providers}
            predicate={modelPredicate}
            value={defaultQuickModel}
            defaultValue={defaultQuickModel}
            style={{ width: 360 }}
            onChange={(value) => setQuickModel(find(allModels, JSON.parse(value)) as Model)}
            placeholder={t('settings.models.empty')}
          />
          <Button icon={<Settings2 size={16} />} style={{ marginLeft: 8 }} onClick={TopicNamingModalPopup.show} />
        </HStack>
        <SettingDescription>{t('settings.models.quick_model.description')}</SettingDescription>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <HStack alignItems="center" gap={10}>
            <Languages size={18} color="var(--color-text)" />
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
          <Button
            icon={<Settings2 size={16} />}
            style={{ marginLeft: 8 }}
            onClick={() => TranslateSettingsPopup.show()}
          />
          {translateModelPrompt !== TRANSLATE_PROMPT && (
            <Tooltip title={t('common.reset')}>
              <Button icon={<RedoOutlined />} style={{ marginLeft: 8 }} onClick={onResetTranslatePrompt}></Button>
            </Tooltip>
          )}
        </HStack>
        <SettingDescription>{t('settings.models.translate_model_description')}</SettingDescription>
      </SettingGroup>
    </SettingContainer>
  )
}

export default ModelSettings
