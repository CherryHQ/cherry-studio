import { Avatar, AvatarFallback, Button, InfoTooltip, PageSidePanel, Tooltip } from '@cherrystudio/ui'
import { useIcon } from '@cherrystudio/ui/icons'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { getProviderDisplayName, ModelSelector } from '@renderer/components/ModelSelector'
import {
  SettingContainer,
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import { TranslateSettingsPanelContent } from '@renderer/pages/translate/TranslateSettings'
import { toast } from '@renderer/services/toast'
import { getModelLogoRef } from '@renderer/utils/model'
import { cn } from '@renderer/utils/style'
import { TRANSLATE_PROMPT } from '@shared/ai/prompts'
import { type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isGenerateImageModel, isNonChatModel } from '@shared/utils/model'
import { ChevronDown, Languages, MessageSquareMore, Palette, Rocket, RotateCcw, Settings2 } from 'lucide-react'
import type { ComponentProps, FC, ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopicNamingSettings } from './TopicNamingSettings'

const logger = loggerService.withContext('ModelSettings')

interface ModelSettingsProps {
  showSettingsButton?: boolean
  showDescription?: boolean
  showDividers?: boolean
  compact?: boolean
  className?: string
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

interface ModelSelectorTriggerProps extends Omit<ComponentProps<typeof Button>, 'children' | 'onSelect'> {
  model?: Model
  providers: Provider[]
  placeholder: string
  compact?: boolean
}

interface DefaultModelSelectorProps extends ModelSelectorTriggerProps {
  filter: (model: Model) => boolean
  onSelect: (model: Model | undefined) => void
}

type ModelSettingsPanel = 'quick-model' | 'translate' | null

const MODEL_SETTINGS_DRAWER_WIDTH_CLASS = '!w-[min(31.25rem,calc(100%-1rem))]'
const TRANSLATE_DRAWER_WIDTH_CLASS = '!w-[min(31.25rem,calc(100%-1rem))]'
const SETTINGS_DRAWER_BODY_CLASS = 'space-y-0 px-6 py-5'

const drawerTitleClassName = 'truncate font-semibold text-foreground text-sm leading-4'

const getModelInitial = (model: Model) => model.name.trim().charAt(0) || 'M'

const ModelSelectorTriggerButton: FC<ModelSelectorTriggerProps> = ({
  model,
  providers,
  placeholder,
  compact,
  className,
  ...props
}) => {
  const provider = model ? providers.find((item) => item.id === model.providerId) : undefined
  const providerName = provider ? getProviderDisplayName(provider) : undefined
  const icon = useIcon(model ? getModelLogoRef(model) : undefined)

  return (
    <Button
      {...props}
      type="button"
      variant="outline"
      size={compact ? 'lg' : 'default'}
      className={cn(
        'min-w-0 flex-1 justify-between px-2.5 text-left font-normal',
        compact ? 'h-9' : 'h-7.5',
        className
      )}>
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
  model,
  providers,
  placeholder,
  compact,
  filter,
  onSelect
}) => (
  <ModelSelector
    multiple={false}
    value={model}
    onSelect={onSelect}
    filter={filter}
    trigger={
      <ModelSelectorTriggerButton model={model} providers={providers} placeholder={placeholder} compact={compact} />
    }
  />
)

const ModelSettings: FC<ModelSettingsProps> = ({
  showSettingsButton = true,
  showDescription = true,
  showDividers = true,
  compact = false,
  className
}) => {
  const {
    defaultModel,
    quickModel,
    translateModel,
    paintingModel,
    setDefaultModel,
    setQuickModel,
    setTranslateModel,
    setPaintingModel
  } = useDefaultModel()
  const { providers } = useProviders({ enabled: true })
  const [activePanel, setActivePanel] = useState<ModelSettingsPanel>(null)
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [translateModelPrompt, setTranslateModelPrompt] = usePreference('feature.translate.model_prompt')

  const modelFilter = useCallback((model: Model) => !isNonChatModel(model), [])

  const onSelectDefault = useCallback(
    (selected: Model | undefined) => {
      if (!selected) return
      void setDefaultModel(selected).catch((error) => {
        logger.error('Failed to set default model', { modelId: selected.id, error })
        toast.error(t('settings.models.manage.operation_failed'))
      })
    },
    [setDefaultModel, t]
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

  const onSelectPainting = useCallback(
    (selected: Model | undefined) => {
      if (!selected) return
      void setPaintingModel(selected)
    },
    [setPaintingModel]
  )

  const onResetTranslatePrompt = () => {
    void setTranslateModelPrompt(TRANSLATE_PROMPT)
  }

  const closePanel = useCallback(() => {
    setActivePanel(null)
  }, [])

  const groupStyle = compact ? { padding: 0, border: 'none', background: 'transparent' } : undefined

  const ContainerComponent = compact ? SettingContainer : SettingsContentColumn
  const containerProps = compact ? { style: { padding: 0, background: 'transparent' } } : {}

  return (
    <div className={cn('relative flex min-h-0 flex-1', className)}>
      <ContainerComponent theme={theme} {...containerProps}>
        <SettingGroup theme={theme} style={groupStyle} className={compact ? 'space-y-3' : undefined}>
          {!compact && (
            <>
              <SettingTitle>{t('settings.model')}</SettingTitle>
              <SettingDivider />
            </>
          )}
          <ModelSettingRow
            compact={compact}
            icon={<MessageSquareMore size={16} className="lucide-custom shrink-0 text-foreground" />}
            title={t('settings.models.default_assistant_model')}
            description={showDescription ? t('settings.models.default_assistant_model_description') : undefined}>
            <DefaultModelSelector
              model={defaultModel}
              providers={providers}
              filter={modelFilter}
              compact={compact}
              onSelect={onSelectDefault}
              placeholder={t('settings.models.empty')}
            />
          </ModelSettingRow>
          {showDividers && <SettingDivider />}
          <ModelSettingRow
            compact={compact}
            icon={<Rocket size={16} className="lucide-custom shrink-0 text-foreground" />}
            title={
              <>
                {t('settings.models.quick_model.label')}
                <InfoTooltip content={t('settings.models.quick_model.tooltip')} />
              </>
            }
            description={showDescription ? t('settings.models.quick_model.description') : undefined}>
            <DefaultModelSelector
              model={quickModel}
              providers={providers}
              filter={modelFilter}
              compact={compact}
              onSelect={onSelectQuick}
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
          {showDividers && <SettingDivider />}
          <ModelSettingRow
            compact={compact}
            icon={<Languages size={16} className="lucide-custom shrink-0 text-foreground" />}
            title={t('settings.models.translate_model')}
            description={showDescription ? t('settings.models.translate_model_description') : undefined}>
            <DefaultModelSelector
              model={translateModel}
              providers={providers}
              filter={modelFilter}
              compact={compact}
              onSelect={onSelectTranslate}
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
                  <Tooltip content={t('common.reset')}>
                    <Button className="shrink-0" onClick={onResetTranslatePrompt} size="icon-sm" variant="outline">
                      <RotateCcw size={16} />
                    </Button>
                  </Tooltip>
                )}
              </>
            )}
          </ModelSettingRow>
          <SettingDivider />
          <ModelSettingRow
            compact={compact}
            icon={<Palette size={16} className="lucide-custom shrink-0 text-foreground" />}
            title={t('settings.models.painting_model')}
            description={showDescription ? t('settings.models.painting_model_description') : undefined}>
            <DefaultModelSelector
              model={paintingModel}
              providers={providers}
              filter={isGenerateImageModel}
              compact={compact}
              onSelect={onSelectPainting}
              placeholder={t('settings.models.empty')}
            />
          </ModelSettingRow>
        </SettingGroup>
      </ContainerComponent>
      {showSettingsButton && (
        <>
          <PageSidePanel
            open={activePanel === 'quick-model'}
            onClose={closePanel}
            closeLabel={t('common.close')}
            header={<h2 className={drawerTitleClassName}>{t('settings.models.quick_model.setting_title')}</h2>}
            contentClassName={MODEL_SETTINGS_DRAWER_WIDTH_CLASS}
            bodyClassName={SETTINGS_DRAWER_BODY_CLASS}>
            <TopicNamingSettings />
          </PageSidePanel>
          <PageSidePanel
            open={activePanel === 'translate'}
            onClose={closePanel}
            closeLabel={t('common.close')}
            header={<h2 className={drawerTitleClassName}>{t('settings.translate.title')}</h2>}
            contentClassName={TRANSLATE_DRAWER_WIDTH_CLASS}
            bodyClassName={SETTINGS_DRAWER_BODY_CLASS}>
            <TranslateSettingsPanelContent />
          </PageSidePanel>
        </>
      )}
    </div>
  )
}

export default ModelSettings
