import { Button, InfoTooltip, Input, PageSidePanel, Switch, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { DefaultModelSelector } from '@renderer/components/DefaultModelSelector'
import { ModelSelector } from '@renderer/components/ModelSelector'
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
import { useTimer } from '@renderer/hooks/useTimer'
import { TranslateSettingsPanelContent } from '@renderer/pages/translate/TranslateSettings'
import { toast } from '@renderer/services/toast'
import { scrollIntoView } from '@renderer/utils/dom'
import { cn } from '@renderer/utils/style'
import { TRANSLATE_PROMPT } from '@shared/ai/prompts'
import type { Model } from '@shared/data/types/model'
import { isGenerateImageModel, isNonChatModel } from '@shared/utils/model'
import { useSearch } from '@tanstack/react-router'
import {
  ArrowRight,
  ChevronDown,
  Languages,
  MessageSquareMore,
  Palette,
  RefreshCcw,
  Rocket,
  RotateCcw,
  Settings2
} from 'lucide-react'
import type { FC, ReactNode, Ref } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { validateModelSettingsSearch } from './modelSettingsFocus'
import { TopicNamingSettings } from './TopicNamingSettings'

const logger = loggerService.withContext('ModelSettings')

interface ModelSettingsProps {
  showSettingsButton?: boolean
  showDescription?: boolean
  showDividers?: boolean
  showPaintingModel?: boolean
  modelFilter?: (model: Model) => boolean
  autoFillEmptyModels?: boolean
  onDefaultModelSelected?: (model: Model) => void | Promise<void>
  compact?: boolean
  className?: string
}

interface ModelSettingRowProps {
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
  compact?: boolean
  children: ReactNode
  rowRef?: Ref<HTMLDivElement>
  showFocusGuide?: boolean
}

const ModelSettingRow: FC<ModelSettingRowProps> = ({
  icon,
  title,
  description,
  compact,
  children,
  rowRef,
  showFocusGuide
}) => (
  <div ref={rowRef}>
    <SettingRow className={cn(compact ? 'flex-col items-stretch gap-3 py-1' : 'items-start gap-6 py-1.5')}>
      <div className="min-w-0 flex-1">
        <SettingRowTitle className="gap-2">
          {icon}
          {title}
        </SettingRowTitle>
        {description && <SettingDescription className="mt-1.5 leading-5">{description}</SettingDescription>}
      </div>
      <div
        className={cn(
          compact ? 'flex w-full items-center gap-2' : 'flex w-[340px] shrink-0 items-center gap-2',
          'relative'
        )}>
        {showFocusGuide && (
          <span
            aria-hidden="true"
            data-testid="model-settings-focus-guide"
            className="animation-provider-model-pull-guide motion-reduce:-translate-y-1/2 motion-reduce:!animate-none pointer-events-none absolute top-1/2 right-full z-10 mr-1 flex h-4 w-5 items-center justify-end text-muted-foreground">
            <ArrowRight className="size-4" strokeWidth={2.5} />
          </span>
        )}
        {children}
      </div>
    </SettingRow>
  </div>
)

type ModelSettingsPanel = 'quick-model' | 'translate' | null

const MODEL_SETTINGS_DRAWER_WIDTH_CLASS = '!w-[min(31.25rem,calc(100%-1rem))]'
const TRANSLATE_DRAWER_WIDTH_CLASS = '!w-[min(31.25rem,calc(100%-1rem))]'
const SETTINGS_DRAWER_BODY_CLASS = 'space-y-0 px-6 py-5'

const drawerTitleClassName = 'truncate font-semibold text-foreground text-sm leading-4'

const ModelSettings: FC<ModelSettingsProps> = ({
  showSettingsButton = true,
  showDescription = true,
  showDividers = true,
  showPaintingModel = true,
  modelFilter,
  autoFillEmptyModels = false,
  onDefaultModelSelected,
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
  const { focus } = validateModelSettingsSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const defaultRowRef = useRef<HTMLDivElement | null>(null)
  const translateRowRef = useRef<HTMLDivElement | null>(null)
  const [showFocusGuide, setShowFocusGuide] = useState(false)
  const { setTimeoutTimer } = useTimer()

  const [translateModelPrompt, setTranslateModelPrompt] = usePreference('feature.translate.model_prompt')
  const [retryEnabled, setRetryEnabled] = usePreference('chat.retry.enabled')
  const [retryMaxAttempts, setRetryMaxAttempts] = usePreference('chat.retry.max_attempts')
  const [retryBackoffEnabled, setRetryBackoffEnabled] = usePreference('chat.retry.backoff_enabled')
  const [retryFallbackModelIds, setRetryFallbackModelIds] = usePreference('chat.retry.fallback_model_ids')

  const chatModelFilter = useCallback(
    (model: Model) => !isNonChatModel(model) && (modelFilter?.(model) ?? true),
    [modelFilter]
  )
  const selectableDefaultModel = defaultModel && chatModelFilter(defaultModel) ? defaultModel : undefined
  const selectableQuickModel = quickModel && chatModelFilter(quickModel) ? quickModel : undefined
  const selectableTranslateModel = translateModel && chatModelFilter(translateModel) ? translateModel : undefined
  const shouldAutoFillEmptyModels =
    autoFillEmptyModels && !selectableDefaultModel && !selectableQuickModel && !selectableTranslateModel

  const onSelectDefault = useCallback(
    (selected: Model | undefined) => {
      if (!selected) return

      const updatePromise = shouldAutoFillEmptyModels
        ? setDefaultModel(selected, { forceCascade: true })
        : setDefaultModel(selected)
      void updatePromise
        .then(() => onDefaultModelSelected?.(selected))
        .catch((error) => {
          logger.error('Failed to handle default model selection', { modelId: selected.id, error })
          toast.error(t('settings.models.manage.operation_failed'))
        })
    },
    [onDefaultModelSelected, setDefaultModel, shouldAutoFillEmptyModels, t]
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

  useEffect(() => {
    if (compact || !focus) return

    const target = focus === 'default' ? defaultRowRef.current : translateRowRef.current
    if (!target) return

    const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    scrollIntoView(target, { behavior, block: 'center', inline: 'nearest' })
    setShowFocusGuide(true)
    setTimeoutTimer('model-settings-focus-guide', () => setShowFocusGuide(false), 1200)
  }, [compact, focus, setTimeoutTimer])

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
            rowRef={defaultRowRef}
            showFocusGuide={focus === 'default' && showFocusGuide}
            icon={<MessageSquareMore size={16} className="lucide-custom shrink-0 text-foreground" />}
            title={t('settings.models.default_assistant_model')}
            description={showDescription ? t('settings.models.default_assistant_model_description') : undefined}>
            <DefaultModelSelector
              model={selectableDefaultModel}
              providers={providers}
              filter={chatModelFilter}
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
              model={selectableQuickModel}
              providers={providers}
              filter={chatModelFilter}
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
            rowRef={translateRowRef}
            showFocusGuide={focus === 'translate' && showFocusGuide}
            icon={<Languages size={16} className="lucide-custom shrink-0 text-foreground" />}
            title={t('settings.models.translate_model')}
            description={showDescription ? t('settings.models.translate_model_description') : undefined}>
            <DefaultModelSelector
              model={selectableTranslateModel}
              providers={providers}
              filter={chatModelFilter}
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
          {showPaintingModel && (
            <>
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
            </>
          )}
          <SettingDivider />
          <ModelSettingRow
            compact={compact}
            icon={<RefreshCcw size={16} className="lucide-custom shrink-0 text-foreground" />}
            title={
              <>
                {t('settings.models.retry.label')}
                <InfoTooltip content={t('settings.models.retry.tooltip')} />
              </>
            }
            description={showDescription ? t('settings.models.retry.description') : undefined}>
            <Switch
              checked={retryEnabled}
              onCheckedChange={(checked) => void setRetryEnabled(checked)}
              aria-label={t('settings.models.retry.label')}
            />
          </ModelSettingRow>
          {retryEnabled && (
            <>
              <SettingDivider />
              <ModelSettingRow compact={compact} icon={null} title={t('settings.models.retry.max_attempts')}>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  className="w-24"
                  aria-label={t('settings.models.retry.max_attempts')}
                  value={retryMaxAttempts}
                  // Clamp on change: an empty field gives Number('') === 0, which a
                  // range guard would reject — trapping the edit. Clamp instead.
                  onChange={(e) =>
                    void setRetryMaxAttempts(Math.min(10, Math.max(1, Math.trunc(Number(e.target.value)) || 1)))
                  }
                />
              </ModelSettingRow>
              <SettingDivider />
              <ModelSettingRow compact={compact} icon={null} title={t('settings.models.retry.backoff')}>
                <Switch
                  checked={retryBackoffEnabled}
                  onCheckedChange={(checked) => void setRetryBackoffEnabled(checked)}
                  aria-label={t('settings.models.retry.backoff')}
                />
              </ModelSettingRow>
              <SettingDivider />
              <ModelSettingRow
                compact={compact}
                icon={null}
                title={t('settings.models.retry.fallback_models')}
                description={showDescription ? t('settings.models.retry.fallback_models_description') : undefined}>
                <ModelSelector
                  multiple={true}
                  selectionType="id"
                  value={retryFallbackModelIds}
                  onSelect={(modelIds) => void setRetryFallbackModelIds(modelIds)}
                  filter={chatModelFilter}
                  trigger={
                    <Button
                      type="button"
                      variant="outline"
                      size={compact ? 'lg' : 'default'}
                      className={cn(
                        'min-w-0 flex-1 justify-between px-2.5 text-left font-normal',
                        compact ? 'h-9' : 'h-7.5'
                      )}>
                      <span className="min-w-0 flex-1 truncate">
                        {retryFallbackModelIds.length > 0
                          ? t('settings.models.retry.fallback_models_count', { count: retryFallbackModelIds.length })
                          : t('settings.models.empty')}
                      </span>
                      <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                    </Button>
                  }
                />
              </ModelSettingRow>
            </>
          )}
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
