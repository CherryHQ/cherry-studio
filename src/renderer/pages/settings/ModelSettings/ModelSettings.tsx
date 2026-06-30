import { Avatar, AvatarFallback, Button, PageSidePanel, Tooltip } from '@cherrystudio/ui'
import { resolveIcon } from '@cherrystudio/ui/icons'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ModelSelector } from '@renderer/components/Selector/model'
import { getProviderDisplayName } from '@renderer/components/Selector/model/utils'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import { TranslateSettingsPanelContent } from '@renderer/pages/translate/TranslateSettings'
import { cn } from '@renderer/utils/style'
import { TRANSLATE_PROMPT } from '@shared/ai/prompts'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNonChatModel } from '@shared/utils/model'
import { ChevronDown, Languages, MessageSquareMore, Package, Rocket, RotateCcw, Settings2 } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SettingContainer,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingsPageHeader
} from '..'
import { TopicNamingSettings } from './QuickModelPopup'

const logger = loggerService.withContext('ModelSettings')

interface ModelSettingsProps {
  showSettingsButton?: boolean
  showDescription?: boolean
  compact?: boolean
}

interface ModelSettingRowProps {
  icon: ReactNode
  title: ReactNode
  tip?: ReactNode
  compact?: boolean
  children: ReactNode
}

const ModelSettingRow: FC<ModelSettingRowProps> = ({ icon, title, tip, compact, children }) => (
  <SettingRow className={cn('rounded-xl border border-border/60 px-4 py-3', compact && 'flex-col items-stretch gap-3')}>
    <SettingRowTitle
      tip={tip}
      className="text-(length:--font-size-body-sm) min-w-0 flex-1 gap-2 leading-(--line-height-body-sm) [&_svg]:shrink-0">
      {icon}
      <span className="min-w-0 truncate">{title}</span>
    </SettingRowTitle>
    <div className={compact ? 'flex w-full items-center gap-2' : 'flex min-w-0 max-w-[340px] flex-1 items-center gap-2'}>
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
  filter: (model: Model) => boolean
  onSelect: (model: Model | undefined) => void
}

type ModelSettingsPanel = 'quick-model' | 'translate' | null

const MODEL_SETTINGS_DRAWER_WIDTH_CLASS = '!w-[min(31.25rem,calc(100%-1rem))]'
const TRANSLATE_DRAWER_WIDTH_CLASS = '!w-[min(31.25rem,calc(100%-1rem))]'
const SETTINGS_DRAWER_BODY_CLASS = 'space-y-0 px-6 py-5'

const drawerTitleClassName = 'truncate font-semibold text-foreground text-sm leading-4'

const getModelIdentifier = (model: Model) => model.apiModelId ?? parseUniqueModelId(model.id).modelId

const getModelInitial = (model: Model) => model.name.trim().charAt(0) || 'M'

const renderModelSelectorTrigger = ({ model, providers, placeholder, compact }: ModelSelectorTriggerProps) => {
  const provider = model ? providers.find((item) => item.id === model.providerId) : undefined
  const providerName = provider ? getProviderDisplayName(provider) : undefined
  const icon = model ? resolveIcon(getModelIdentifier(model), model.providerId) : undefined

  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? 'lg' : 'default'}
      className={cn(
        'min-w-0 flex-1 justify-between rounded-lg bg-muted/50 px-2.5 text-left font-normal hover:bg-muted data-[state=open]:bg-muted',
        compact ? 'h-8' : 'h-7'
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
      <ChevronDown size={14} className="lucide-custom shrink-0 text-muted-foreground/40" />
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
    trigger={renderModelSelectorTrigger({ model, providers, placeholder, compact })}
  />
)

const ModelSettings: FC<ModelSettingsProps> = ({
  showSettingsButton = true,
  showDescription = true,
  compact = false
}) => {
  const { defaultModel, quickModel, translateModel, setDefaultModel, setQuickModel, setTranslateModel } =
    useDefaultModel()
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
        window.toast.error(t('settings.models.manage.operation_failed'))
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
    <div className="relative flex min-h-0 flex-1">
      <ContainerComponent theme={theme} {...containerProps}>
        <SettingGroup theme={theme} style={groupStyle}>
          {!compact && (
            <SettingsPageHeader
              icon={<Package />}
              title={t('settings.model')}
              description={t('settings.models.page_description')}
            />
          )}
          <div className="mt-4 space-y-4">
            <ModelSettingRow
              compact={compact}
              icon={
                <MessageSquareMore
                  size={16}
                  className="lucide-custom shrink-0 text-foreground [stroke-width:var(--icon-stroke)]"
                />
              }
              title={t('settings.models.default_assistant_model')}
              tip={showDescription ? t('settings.models.default_assistant_model_description') : undefined}>
              <DefaultModelSelector
                model={defaultModel}
                providers={providers}
                filter={modelFilter}
                compact={compact}
                onSelect={onSelectDefault}
                placeholder={t('settings.models.empty')}
              />
            </ModelSettingRow>
            <ModelSettingRow
              compact={compact}
              icon={
                <Rocket
                  size={16}
                  className="lucide-custom shrink-0 text-foreground [stroke-width:var(--icon-stroke)]"
                />
              }
              title={t('settings.models.quick_model.label')}
              tip={
                showDescription ? (
                  <>
                    {t('settings.models.quick_model.description')}
                    <br />
                    {t('settings.models.quick_model.tooltip')}
                  </>
                ) : (
                  t('settings.models.quick_model.tooltip')
                )
              }>
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
                  className="shrink-0 rounded-lg border-[color:var(--color-border-fg-muted)] hover:bg-(--color-surface-fg-subtle-solid) [&_svg]:size-3.5! [&_svg]:[stroke-width:var(--icon-stroke)]"
                  onClick={() => setActivePanel('quick-model')}
                  size="icon-sm"
                  variant="outline">
                  <Settings2 />
                </Button>
              )}
            </ModelSettingRow>
            <ModelSettingRow
              compact={compact}
              icon={
                <Languages
                  size={16}
                  className="lucide-custom shrink-0 text-foreground [stroke-width:var(--icon-stroke)]"
                />
              }
              title={t('settings.models.translate_model')}
              tip={showDescription ? t('settings.models.translate_model_description') : undefined}>
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
                    className="shrink-0 rounded-lg border-[color:var(--color-border-fg-muted)] hover:bg-(--color-surface-fg-subtle-solid) [&_svg]:size-3.5! [&_svg]:[stroke-width:var(--icon-stroke)]"
                    onClick={() => setActivePanel('translate')}
                    size="icon-sm"
                    variant="outline">
                    <Settings2 />
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
          </div>
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
