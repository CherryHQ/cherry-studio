import { RedoOutlined } from '@ant-design/icons'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  InfoTooltip,
  RowFlex,
  Tooltip
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useDefaultModel } from '@renderer/hooks/useModels'
import AssistantSettingsPopup from '@renderer/pages/home/AssistantSettings'
import { TranslateSettingsPanelContent } from '@renderer/pages/translate/TranslateSettings'
import { TRANSLATE_PROMPT } from '@shared/config/prompts'
import type { Model } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'
import { Languages, MessageSquareMore, PlusIcon, Rocket, Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDescription, SettingGroup, SettingTitle } from '..'
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
  const { assistant: defaultAssistant } = useDefaultAssistant()
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [translateModelPrompt, setTranslateModelPrompt] = usePreference('feature.translate.model_prompt')
  const [translateSettingsOpen, setTranslateSettingsOpen] = useState(false)

  const modelFilter = useCallback((m: Model) => !isNonChatModel(m), [])

  const onSelectDefault = useCallback(
    (selected: Model | undefined) => {
      if (!selected) return
      void setDefaultModel(selected)
    },
    [setDefaultModel]
  )

  const onSelectQuick = useCallback(
    (selected: Model | undefined) => {
      if (!selected) return
      void setQuickModel(selected)
    },
    [setQuickModel]
  )

  const onSelectTranslate = useCallback(
    (selected: Model | undefined) => {
      if (!selected) return
      void setTranslateModel(selected)
    },
    [setTranslateModel]
  )

  const onResetTranslatePrompt = () => {
    void setTranslateModelPrompt(TRANSLATE_PROMPT)
  }

  const containerStyle = compact ? { padding: 0, background: 'transparent' } : undefined
  const groupStyle = compact ? { padding: 0, border: 'none', background: 'transparent' } : undefined
  const triggerStyle = { width: compact ? '100%' : 360 }

  const renderTrigger = (model: Model | undefined) => {
    return (
      <Button variant="outline" className="justify-start" style={triggerStyle}>
        {model ? <ModelAvatar model={model} size={18} /> : <PlusIcon size={16} />}
        <span className="truncate">{model ? model.name : t('settings.models.empty')}</span>
      </Button>
    )
  }

  return (
    <SettingContainer theme={theme} style={containerStyle}>
      <SettingGroup theme={theme} style={groupStyle}>
        <SettingTitle style={{ justifyContent: 'flex-start', gap: 10, marginBottom: 12 }}>
          <MessageSquareMore size={18} className="lucide-custom shrink-0 text-(--color-text-1)" />
          {t('settings.models.default_assistant_model')}
        </SettingTitle>
        <RowFlex className="items-center">
          <ModelSelector
            multiple={false}
            value={defaultModel}
            filter={modelFilter}
            onSelect={onSelectDefault}
            trigger={renderTrigger(defaultModel)}
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
            multiple={false}
            value={quickModel}
            filter={modelFilter}
            onSelect={onSelectQuick}
            trigger={renderTrigger(quickModel)}
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
            multiple={false}
            value={translateModel}
            filter={modelFilter}
            onSelect={onSelectTranslate}
            trigger={renderTrigger(translateModel)}
          />
          {showSettingsButton && (
            <>
              <Button className="ml-2" onClick={() => setTranslateSettingsOpen(true)} size="icon">
                <Settings2 size={16} />
              </Button>
              {translateModelPrompt !== TRANSLATE_PROMPT && (
                <Tooltip title={t('common.reset')}>
                  <Button className="ml-2" onClick={onResetTranslatePrompt} size="icon">
                    <RedoOutlined size={16} />
                  </Button>
                </Tooltip>
              )}
              <Dialog open={translateSettingsOpen} onOpenChange={setTranslateSettingsOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('settings.translate.title')}</DialogTitle>
                  </DialogHeader>
                  <TranslateSettingsPanelContent />
                </DialogContent>
              </Dialog>
            </>
          )}
        </RowFlex>
        <SettingDescription>{t('settings.models.translate_model_description')}</SettingDescription>
      </SettingGroup>
    </SettingContainer>
  )
}

export default ModelSettings
