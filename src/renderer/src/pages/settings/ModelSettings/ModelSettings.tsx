import { RedoOutlined } from '@ant-design/icons'
import { Button, InfoTooltip, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ModelSelector from '@renderer/components/ModelSelectorLegacy'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId, hasModel } from '@renderer/services/ModelService'
import type { Model } from '@renderer/types'
import { TRANSLATE_PROMPT } from '@shared/config/prompts'
import { find } from 'lodash'
import { Languages, MessageSquareMore, Rocket, Settings2 } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDescription, SettingDivider, SettingGroup, SettingRow, SettingRowTitle } from '..'
import TranslateSettingsPopup from '../TranslateSettingsPopup/TranslateSettingsPopup'
import DefaultAssistantSettings from './DefaultAssistantSettings'
import TopicNamingModalPopup from './QuickModelPopup'

interface ModelSettingsProps {
  showSettingsButton?: boolean
  showDescription?: boolean
  compact?: boolean
}

interface ModelSettingRowProps {
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
  compact?: boolean
  children: ReactNode
}

const ModelSettingRow: FC<ModelSettingRowProps> = ({ icon, title, description, compact, children }) => (
  <SettingRow className="flex-col items-stretch gap-3 py-1">
    <div className="min-w-0">
      <SettingRowTitle className="gap-2 font-semibold">
        {icon}
        {title}
      </SettingRowTitle>
      {description && <SettingDescription className="mt-1.5 leading-5">{description}</SettingDescription>}
    </div>
    <div className={compact ? 'flex w-full items-center gap-2' : 'flex w-full max-w-[420px] items-center gap-2'}>
      {children}
    </div>
  </SettingRow>
)

const ModelSettings: FC<ModelSettingsProps> = ({
  showSettingsButton = true,
  showDescription = true,
  compact = false
}) => {
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
    void setTranslateModelPrompt(TRANSLATE_PROMPT)
  }

  const containerStyle = compact ? { padding: 0, background: 'transparent' } : undefined
  const groupStyle = compact ? { padding: 0, border: 'none', background: 'transparent' } : undefined
  const selectorStyle = { width: '100%' }

  return (
    <SettingContainer theme={theme} style={containerStyle}>
      <SettingGroup theme={theme} style={groupStyle}>
        <ModelSettingRow
          compact={compact}
          icon={<MessageSquareMore size={16} className="lucide-custom shrink-0 text-(--color-foreground)" />}
          title={t('settings.models.default_assistant_model')}
          description={showDescription ? t('settings.models.default_assistant_model_description') : undefined}>
          <ModelSelector
            className="min-w-0 flex-1"
            providers={providers}
            predicate={modelPredicate}
            value={defaultModelValue}
            defaultValue={defaultModelValue}
            style={selectorStyle}
            size={compact ? 'large' : 'middle'}
            onChange={(value) => setDefaultModel(find(allModels, JSON.parse(value)) as Model)}
            placeholder={t('settings.models.empty')}
          />
          {showSettingsButton && (
            <Button className="shrink-0" onClick={DefaultAssistantSettings.show} size="icon-sm" variant="outline">
              <Settings2 size={16} />
            </Button>
          )}
        </ModelSettingRow>
        <SettingDivider />
        <ModelSettingRow
          compact={compact}
          icon={<Rocket size={16} className="lucide-custom shrink-0 text-(--color-foreground)" />}
          title={
            <>
              {t('settings.models.quick_model.label')}
              <InfoTooltip content={t('settings.models.quick_model.tooltip')} />
            </>
          }
          description={showDescription ? t('settings.models.quick_model.description') : undefined}>
          <ModelSelector
            className="min-w-0 flex-1"
            providers={providers}
            predicate={modelPredicate}
            value={defaultQuickModel}
            defaultValue={defaultQuickModel}
            style={selectorStyle}
            size={compact ? 'large' : 'middle'}
            onChange={(value) => setQuickModel(find(allModels, JSON.parse(value)) as Model)}
            placeholder={t('settings.models.empty')}
          />
          {showSettingsButton && (
            <Button className="shrink-0" onClick={TopicNamingModalPopup.show} size="icon-sm" variant="outline">
              <Settings2 size={16} />
            </Button>
          )}
        </ModelSettingRow>
        <SettingDivider />
        <ModelSettingRow
          compact={compact}
          icon={<Languages size={16} className="lucide-custom shrink-0 text-(--color-foreground)" />}
          title={t('settings.models.translate_model')}
          description={showDescription ? t('settings.models.translate_model_description') : undefined}>
          <ModelSelector
            className="min-w-0 flex-1"
            providers={providers}
            predicate={modelPredicate}
            value={defaultTranslateModel}
            defaultValue={defaultTranslateModel}
            style={selectorStyle}
            size={compact ? 'large' : 'middle'}
            onChange={(value) => setTranslateModel(find(allModels, JSON.parse(value)) as Model)}
            placeholder={t('settings.models.empty')}
          />
          {showSettingsButton && (
            <>
              <Button className="shrink-0" onClick={TranslateSettingsPopup.show} size="icon-sm" variant="outline">
                <Settings2 size={16} />
              </Button>
              {translateModelPrompt !== TRANSLATE_PROMPT && (
                <Tooltip title={t('common.reset')}>
                  <Button className="shrink-0" onClick={onResetTranslatePrompt} size="icon-sm" variant="outline">
                    <RedoOutlined size={16} />
                  </Button>
                </Tooltip>
              )}
            </>
          )}
        </ModelSettingRow>
      </SettingGroup>
    </SettingContainer>
  )
}

export default ModelSettings
