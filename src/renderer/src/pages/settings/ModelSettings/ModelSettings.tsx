import { RedoOutlined } from '@ant-design/icons'
import { Button, InfoTooltip, RowFlex, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ModelSelector from '@renderer/components/ModelSelector'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useDefaultModel } from '@renderer/hooks/useModels'
import { useProviders } from '@renderer/hooks/useProvider'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { Model } from '@renderer/types'
import { TRANSLATE_PROMPT } from '@shared/config/prompts'
import { DEFAULT_ASSISTANT_ID } from '@shared/data/types/assistant'
import { find } from 'lodash'
import { Languages, MessageSquareMore, Rocket, Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDescription, SettingGroup, SettingTitle } from '..'
import TranslateSettingsPopup from '../TranslateSettingsPopup/TranslateSettingsPopup'
import TopicNamingModalPopup from './QuickModelPopup'

interface ModelSettingsProps {
  showSettingsButton?: boolean
  showDescription?: boolean
  compact?: boolean
}

const ModelSettings: FC<ModelSettingsProps> = ({
  showSettingsButton = true,
  showDescription = true,
  compact = false
}) => {
  const { defaultModel, quickModel, translateModel, setDefaultModel, setQuickModel, setTranslateModel } =
    useDefaultModel()
  const { assistant: defaultAssistant } = useAssistant(DEFAULT_ASSISTANT_ID)
  const { providers } = useProviders()
  const allModels = providers.map((p) => p.models).flat()
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [translateModelPrompt, setTranslateModelPrompt] = usePreference('feature.translate.model_prompt')

  const modelPredicate = useCallback(
    (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m) && !isTextToImageModel(m),
    []
  )

  const v1DefaultModel = useMemo(() => (defaultModel ? fromSharedModel(defaultModel) : undefined), [defaultModel])
  const v1QuickModel = useMemo(() => (quickModel ? fromSharedModel(quickModel) : undefined), [quickModel])
  const v1TranslateModel = useMemo(
    () => (translateModel ? fromSharedModel(translateModel) : undefined),
    [translateModel]
  )

  const defaultModelValue = useMemo(
    () => (v1DefaultModel ? getModelUniqId(v1DefaultModel) : undefined),
    [v1DefaultModel]
  )

  const defaultQuickModel = useMemo(() => (v1QuickModel ? getModelUniqId(v1QuickModel) : undefined), [v1QuickModel])

  const defaultTranslateModel = useMemo(
    () => (v1TranslateModel ? getModelUniqId(v1TranslateModel) : undefined),
    [v1TranslateModel]
  )

  const onResetTranslatePrompt = () => {
    void setTranslateModelPrompt(TRANSLATE_PROMPT)
  }

  const containerStyle = compact ? { padding: 0, background: 'transparent' } : undefined
  const groupStyle = compact ? { padding: 0, border: 'none', background: 'transparent' } : undefined

  return (
    <SettingContainer theme={theme} style={containerStyle}>
      <SettingGroup theme={theme} style={groupStyle}>
        <SettingTitle style={{ justifyContent: 'flex-start', gap: 10, marginBottom: 12 }}>
          <MessageSquareMore size={18} className="lucide-custom shrink-0 text-(--color-text-1)" />
          {t('settings.models.default_assistant_model')}
        </SettingTitle>
        <RowFlex className="items-center">
          <ModelSelector
            providers={providers}
            predicate={modelPredicate}
            value={defaultModelValue}
            defaultValue={defaultModelValue}
            style={{ width: compact ? '100%' : 360 }}
            size={compact ? 'large' : 'middle'}
            onChange={(value) => setDefaultModel(find(allModels, JSON.parse(value)) as Model)}
            placeholder={t('settings.models.empty')}
          />
          {showSettingsButton && defaultAssistant && (
            <Button
              className="ml-2"
              onClick={() => AssistantSettingsPopup.show({ assistant: defaultAssistant })}
              size="icon">
              <Settings2 size={16} />
            </Button>
          )}
        </RowFlex>
        {showDescription && (
          <SettingDescription>{t('settings.models.default_assistant_model_description')}</SettingDescription>
        )}
      </SettingGroup>
      <SettingGroup theme={theme} style={groupStyle}>
        <SettingTitle style={{ justifyContent: 'flex-start', gap: 10, marginBottom: 12 }}>
          <Rocket size={18} className="lucide-custom shrink-0 text-(--color-text-1)" />
          {t('settings.models.quick_model.label')}
          <InfoTooltip content={t('settings.models.quick_model.tooltip')} />
        </SettingTitle>
        <RowFlex className="items-center">
          <ModelSelector
            providers={providers}
            predicate={modelPredicate}
            value={defaultQuickModel}
            defaultValue={defaultQuickModel}
            style={{ width: compact ? '100%' : 360 }}
            size={compact ? 'large' : 'middle'}
            onChange={(value) => setQuickModel(find(allModels, JSON.parse(value)) as Model)}
            placeholder={t('settings.models.empty')}
          />
          {showSettingsButton && (
            <Button className="ml-2" onClick={TopicNamingModalPopup.show} size="icon">
              <Settings2 size={16} />
            </Button>
          )}
        </RowFlex>
        {showDescription && <SettingDescription>{t('settings.models.quick_model.description')}</SettingDescription>}
      </SettingGroup>
      <SettingGroup theme={theme} style={groupStyle}>
        <SettingTitle style={{ justifyContent: 'flex-start', gap: 10, marginBottom: 12 }}>
          <Languages size={18} className="lucide-custom shrink-0 text-(--color-text-1)" />
          {t('settings.models.translate_model')}
        </SettingTitle>
        <RowFlex className="items-center">
          <ModelSelector
            providers={providers}
            predicate={modelPredicate}
            value={defaultTranslateModel}
            defaultValue={defaultTranslateModel}
            style={{ width: compact ? '100%' : 360 }}
            size={compact ? 'large' : 'middle'}
            onChange={(value) => setTranslateModel(find(allModels, JSON.parse(value)) as Model)}
            placeholder={t('settings.models.empty')}
          />
          {showSettingsButton && (
            <>
              <Button className="ml-2" onClick={TranslateSettingsPopup.show} size="icon">
                <Settings2 size={16} />
              </Button>
              {translateModelPrompt !== TRANSLATE_PROMPT && (
                <Tooltip title={t('common.reset')}>
                  <Button className="ml-2" onClick={onResetTranslatePrompt} size="icon">
                    <RedoOutlined size={16} />
                  </Button>
                </Tooltip>
              )}
            </>
          )}
        </RowFlex>
        <SettingDescription>{t('settings.models.translate_model_description')}</SettingDescription>
      </SettingGroup>
    </SettingContainer>
  )
}

export default ModelSettings
