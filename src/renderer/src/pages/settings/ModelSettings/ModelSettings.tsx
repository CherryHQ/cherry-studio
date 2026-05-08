import { RedoOutlined } from '@ant-design/icons'
import { Avatar, AvatarFallback, Button, InfoTooltip, PageSidePanel, Tooltip } from '@cherrystudio/ui'
import { resolveIcon } from '@cherrystudio/ui/icons'
import { usePreference } from '@data/hooks/usePreference'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { getProviderDisplayName } from '@renderer/components/ModelSelector/utils'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useModels } from '@renderer/hooks/useModels'
import { useProviders } from '@renderer/hooks/useProviders'
import { TranslateSettingsPanelContent } from '@renderer/pages/translate/components/TranslateSettingsPopup/TranslateSettingsPopup'
import { cn } from '@renderer/utils'
import { TRANSLATE_PROMPT } from '@shared/config/prompts'
import {
  isUniqueModelId,
  type Model,
  MODEL_CAPABILITY,
  parseUniqueModelId,
  type UniqueModelId
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { ChevronDown, Languages, MessageSquareMore, Rocket, Settings2 } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDescription, SettingDivider, SettingGroup, SettingRow, SettingRowTitle } from '..'
import { AssistantSettings } from './DefaultAssistantSettings'
import { TopicNamingSettings } from './QuickModelPopup'

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
  <SettingRow className={cn(compact ? 'flex-col items-stretch gap-3 py-1' : 'items-start gap-6 py-1.5')}>
    <div className="min-w-0 flex-1">
      <SettingRowTitle className="gap-2 font-semibold">
        {icon}
        {title}
      </SettingRowTitle>
      {description && <SettingDescription className="mt-1.5 leading-5">{description}</SettingDescription>}
    </div>
    <div className={compact ? 'flex w-full items-center gap-2' : 'flex w-[340px] shrink-0 items-center gap-2'}>
      {children}
    </div>
  </SettingRow>
)

interface ModelSelectorTriggerProps {
  model?: Model
  providers: Provider[]
  placeholder: string
  compact?: boolean
}

interface DefaultModelSelectorProps extends ModelSelectorTriggerProps {
  value?: UniqueModelId
  filter: (model: Model) => boolean
  onSelect: (modelId: UniqueModelId | undefined) => void
}

type ModelSettingsPanel = 'default-assistant' | 'quick-model' | 'translate' | null

const excludedDefaultModelCapabilities = new Set<string>([
  MODEL_CAPABILITY.EMBEDDING,
  MODEL_CAPABILITY.RERANK,
  MODEL_CAPABILITY.IMAGE_GENERATION
])

const ASSISTANT_SETTINGS_DRAWER_WIDTH_CLASS = '!w-[min(500px,calc(100%-1rem))]'
const MODEL_SETTINGS_DRAWER_WIDTH_CLASS = '!w-[min(500px,calc(100%-1rem))]'
const TRANSLATE_DRAWER_WIDTH_CLASS = '!w-[min(500px,calc(100%-1rem))]'
const SETTINGS_DRAWER_BODY_CLASS = 'space-y-0 px-6 py-5'
const SETTINGS_DRAWER_HEADER_CLASS = 'h-14 px-6'
const MODEL_SELECTOR_VISIBLE_COUNT = 8

const toModelSelectorValue = (modelId: string | null): UniqueModelId | undefined =>
  modelId && isUniqueModelId(modelId) ? modelId : undefined

const getModelIdentifier = (model: Model) => model.apiModelId ?? parseUniqueModelId(model.id).modelId

const getModelInitial = (model: Model) => model.name.trim().charAt(0) || 'M'

const renderModelSelectorTrigger = ({ model, providers, placeholder, compact }: ModelSelectorTriggerProps) => {
  const provider = model ? providers.find((item) => item.id === model.providerId) : undefined
  const providerName = provider ? getProviderDisplayName(provider) : undefined
  const icon = model ? resolveIcon(getModelIdentifier(model), model.providerId) : undefined

  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? 'lg' : 'default'}
      className={cn('min-w-0 flex-1 justify-between px-2.5 text-left font-normal', compact ? 'h-9' : 'h-7.5')}>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {model && icon ? (
          <icon.Avatar size={20} />
        ) : model ? (
          <Avatar size="sm">
            <AvatarFallback>{getModelInitial(model)}</AvatarFallback>
          </Avatar>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{model?.name ?? placeholder}</span>
        {providerName && <span className="max-w-[32%] truncate text-muted-foreground text-xs">{providerName}</span>}
      </span>
      <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
    </Button>
  )
}

const DefaultModelSelector: FC<DefaultModelSelectorProps> = ({
  value,
  model,
  providers,
  placeholder,
  compact,
  filter,
  onSelect
}) => (
  <ModelSelector
    multiple={false}
    selectionType="id"
    value={value}
    onSelect={onSelect}
    filter={filter}
    listVisibleCount={MODEL_SELECTOR_VISIBLE_COUNT}
    trigger={renderModelSelectorTrigger({ model, providers, placeholder, compact })}
  />
)

const ModelSettings: FC<ModelSettingsProps> = ({
  showSettingsButton = true,
  showDescription = true,
  compact = false
}) => {
  const [defaultModelId, setDefaultModelId] = usePreference('chat.default_model_id')
  const [quickModelId, setQuickModelId] = usePreference('feature.quick_assistant.model_id')
  const [translateModelId, setTranslateModelId] = usePreference('feature.translate.model_id')
  const [activePanel, setActivePanel] = useState<ModelSettingsPanel>(null)
  const { models } = useModels({ enabled: true })
  const { providers } = useProviders({ enabled: true })
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [translateModelPrompt, setTranslateModelPrompt] = usePreference('feature.translate.model_prompt')

  const modelPredicate = useCallback(
    (model: Model) => !model.capabilities.some((capability) => excludedDefaultModelCapabilities.has(capability)),
    []
  )

  const modelsById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models])

  const defaultModelValue = toModelSelectorValue(defaultModelId)
  const quickModelValue = toModelSelectorValue(quickModelId)
  const translateModelValue = toModelSelectorValue(translateModelId)

  const defaultModel = defaultModelValue ? modelsById.get(defaultModelValue) : undefined
  const quickModel = quickModelValue ? modelsById.get(quickModelValue) : undefined
  const translateModel = translateModelValue ? modelsById.get(translateModelValue) : undefined

  const onSelectDefaultModel = useCallback(
    (modelId: UniqueModelId | undefined) => {
      void setDefaultModelId(modelId ?? null)
    },
    [setDefaultModelId]
  )

  const onSelectQuickModel = useCallback(
    (modelId: UniqueModelId | undefined) => {
      void setQuickModelId(modelId ?? null)
    },
    [setQuickModelId]
  )

  const onSelectTranslateModel = useCallback(
    (modelId: UniqueModelId | undefined) => {
      void setTranslateModelId(modelId ?? null)
    },
    [setTranslateModelId]
  )

  const onResetTranslatePrompt = () => {
    void setTranslateModelPrompt(TRANSLATE_PROMPT)
  }

  const closePanel = useCallback(() => {
    setActivePanel(null)
  }, [])

  const containerStyle = compact ? { padding: 0, background: 'transparent' } : undefined
  const groupStyle = compact ? { padding: 0, border: 'none', background: 'transparent' } : undefined

  return (
    <div className="relative flex min-h-0 flex-1">
      <SettingContainer theme={theme} style={containerStyle}>
        <SettingGroup theme={theme} style={groupStyle}>
          <ModelSettingRow
            compact={compact}
            icon={<MessageSquareMore size={16} className="lucide-custom shrink-0 text-(--color-foreground)" />}
            title={t('settings.models.default_assistant_model')}
            description={showDescription ? t('settings.models.default_assistant_model_description') : undefined}>
            <DefaultModelSelector
              value={defaultModelValue}
              model={defaultModel}
              providers={providers}
              filter={modelPredicate}
              compact={compact}
              onSelect={onSelectDefaultModel}
              placeholder={t('settings.models.empty')}
            />
            {showSettingsButton && (
              <Button
                aria-label={t('settings.assistant.title')}
                className="shrink-0"
                onClick={() => setActivePanel('default-assistant')}
                size="icon-sm"
                variant="outline">
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
            <DefaultModelSelector
              value={quickModelValue}
              model={quickModel}
              providers={providers}
              filter={modelPredicate}
              compact={compact}
              onSelect={onSelectQuickModel}
              placeholder={t('settings.models.empty')}
            />
            {showSettingsButton && (
              <Button
                aria-label={t('settings.models.quick_model.setting_title')}
                className="shrink-0"
                onClick={() => setActivePanel('quick-model')}
                size="icon-sm"
                variant="outline">
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
            <DefaultModelSelector
              value={translateModelValue}
              model={translateModel}
              providers={providers}
              filter={modelPredicate}
              compact={compact}
              onSelect={onSelectTranslateModel}
              placeholder={t('settings.models.empty')}
            />
            {showSettingsButton && (
              <>
                <Button
                  aria-label={t('settings.translate.title')}
                  className="shrink-0"
                  onClick={() => setActivePanel('translate')}
                  size="icon-sm"
                  variant="outline">
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
      {showSettingsButton && (
        <>
          <PageSidePanel
            open={activePanel === 'default-assistant'}
            onClose={closePanel}
            closeLabel={t('common.close')}
            header={<span className="font-semibold text-sm">{t('settings.assistant.title')}</span>}
            contentClassName={ASSISTANT_SETTINGS_DRAWER_WIDTH_CLASS}
            headerClassName={SETTINGS_DRAWER_HEADER_CLASS}
            bodyClassName={SETTINGS_DRAWER_BODY_CLASS}>
            <AssistantSettings />
          </PageSidePanel>
          <PageSidePanel
            open={activePanel === 'quick-model'}
            onClose={closePanel}
            closeLabel={t('common.close')}
            header={<span className="font-semibold text-sm">{t('settings.models.quick_model.setting_title')}</span>}
            contentClassName={MODEL_SETTINGS_DRAWER_WIDTH_CLASS}
            headerClassName={SETTINGS_DRAWER_HEADER_CLASS}
            bodyClassName={SETTINGS_DRAWER_BODY_CLASS}>
            <TopicNamingSettings />
          </PageSidePanel>
          <PageSidePanel
            open={activePanel === 'translate'}
            onClose={closePanel}
            closeLabel={t('common.close')}
            header={<span className="font-semibold text-sm">{t('settings.translate.title')}</span>}
            contentClassName={TRANSLATE_DRAWER_WIDTH_CLASS}
            headerClassName={SETTINGS_DRAWER_HEADER_CLASS}
            bodyClassName={SETTINGS_DRAWER_BODY_CLASS}>
            <TranslateSettingsPanelContent />
          </PageSidePanel>
        </>
      )}
    </div>
  )
}

export default ModelSettings
