import { Button, InfoTooltip, ResetIcon, RowFlex, Tooltip } from '@cherrystudio/ui'
import ModelSelector from '@renderer/components/ModelSelector'
import { DEFAULT_MODEL_MAP, isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId, hasModel } from '@renderer/services/ModelService'
import type { Model } from '@renderer/types'
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
  const {
    defaultModel,
    quickModel,
    translateModel,
    setDefaultModel,
    setQuickModel,
    setTranslateModel,
    resetDefaultAssistantModel,
    resetQuickModel,
    resetTranslateModel
  } = useDefaultModel()
  const { providers } = useProviders()
  const allModels = providers.map((p) => p.models).flat()
  const { theme } = useTheme()
  const { t } = useTranslation()

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
          <Button className="ml-2" onClick={DefaultAssistantSettings.show} size="icon">
            <Settings2 size={16} />
          </Button>
          {defaultModelValue !== getModelUniqId(DEFAULT_MODEL_MAP.assistant) && (
            <Tooltip title={t('common.reset')}>
              <Button style={{ marginLeft: 8 }} onClick={resetDefaultAssistantModel}>
                <ResetIcon size={16} />
              </Button>
            </Tooltip>
          )}
        </RowFlex>
        <SettingDescription>{t('settings.models.default_assistant_model_description')}</SettingDescription>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <RowFlex className="items-center gap-2.5">
            <Rocket size={18} color="var(--color-text)" />
            {t('settings.models.quick_model.label')}
            <InfoTooltip content={t('settings.models.quick_model.tooltip')} />
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
          <Button className="ml-2" onClick={TopicNamingModalPopup.show} size="icon">
            <Settings2 size={16} />
          </Button>
          {defaultQuickModel !== getModelUniqId(DEFAULT_MODEL_MAP.quick) && (
            <Tooltip title={t('common.reset')}>
              <Button style={{ marginLeft: 8 }} onClick={resetQuickModel}>
                <ResetIcon size={16} />
              </Button>
            </Tooltip>
          )}
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
          <Button className="ml-2" onClick={() => TranslateSettingsPopup.show()} size="icon">
            <Settings2 size={16} />
          </Button>
          {defaultTranslateModel !== getModelUniqId(DEFAULT_MODEL_MAP.translate) && (
            <Tooltip title={t('common.reset')}>
              <Button style={{ marginLeft: 8 }} onClick={resetTranslateModel}>
                <ResetIcon size={16} />
              </Button>
            </Tooltip>
          )}
        </RowFlex>
        <SettingDescription>{t('settings.models.translate_model_description')}</SettingDescription>
      </SettingGroup>
    </SettingContainer>
  )
}

export default ModelSettings
