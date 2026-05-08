import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { LoadingIcon } from '@renderer/components/Icons'
import { useModelMutations, useModels } from '@renderer/hooks/useModels'
import { useProvider } from '@renderer/hooks/useProviders'
import { isNewApiProvider } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import { cn } from '@renderer/utils'
import { getDefaultGroupName } from '@renderer/utils'
import type { EndpointType, Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, parseUniqueModelId } from '@shared/data/types/model'
import { isEmpty } from 'lodash'
import {
  ArrowDownWideNarrow,
  Brain,
  Check,
  Database,
  Eye,
  Gift,
  Globe,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Wrench,
  X
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderActions from '../components/ProviderActions'
import ProviderSettingsDrawer from '../components/ProviderSettingsDrawer'
import { modelListClasses } from '../components/ProviderSettingsPrimitives'
import ManageModelsList from './ManageModelsList'
import { getModelApiId, splitModelIds } from './ModelDrawer/helpers'
import { toCreateModelDto } from './modelSync'
import { useManageModelsDrawerBrowse } from './useManageModelsDrawerBrowse'

const logger = loggerService.withContext('ManageModelsDrawer')

interface ManageModelsDrawerProps {
  open: boolean
  providerId: string
  onClose: () => void
}

export default function ManageModelsDrawer({ open, providerId, onClose }: ManageModelsDrawerProps) {
  const { provider } = useProvider(providerId)
  const { models: existingModels } = useModels({ providerId })
  const { createModel, deleteModel, updateModel, updateModels } = useModelMutations()

  const {
    loadingModels,
    loadModels,
    searchText,
    searchInputRef,
    onSearchInputChange,
    optimisticStatusFilter,
    setStatusFilterKey,
    optimisticFilterType,
    setCapabilityFilterKey,
    modelGroups,
    existingModelIds,
    existingById,
    list,
    browseLoading
  } = useManageModelsDrawerBrowse({
    open,
    providerId,
    provider,
    existingModels
  })

  const [customAddExpanded, setCustomAddExpanded] = useState(false)
  const [customAddModelId, setCustomAddModelId] = useState('')
  const [customAddSubmitting, setCustomAddSubmitting] = useState(false)
  const customAddInputRef = useRef<HTMLInputElement | null>(null)
  const { t } = useTranslation()

  const manageCapabilityFilters = useMemo(
    () =>
      [
        { key: 'all', label: t('models.all'), Icon: LayoutGrid },
        { key: 'reasoning', label: t('models.type.reasoning'), Icon: Brain },
        { key: 'vision', label: t('models.type.vision'), Icon: Eye },
        { key: 'websearch', label: t('models.type.websearch'), Icon: Globe },
        { key: 'free', label: t('models.type.free'), Icon: Gift },
        { key: 'embedding', label: t('models.type.embedding'), Icon: Database },
        { key: 'rerank', label: t('models.type.rerank'), Icon: ArrowDownWideNarrow },
        { key: 'function_calling', label: t('models.type.function_calling'), Icon: Wrench }
      ] as const,
    [t]
  )

  useEffect(() => {
    if (!open) {
      setCustomAddExpanded(false)
      setCustomAddModelId('')
      setCustomAddSubmitting(false)
    }
  }, [open])

  const cancelInlineCustomModel = useCallback(() => {
    setCustomAddExpanded(false)
    setCustomAddModelId('')
  }, [])

  const submitInlineCustomModel = useCallback(async () => {
    if (!provider || customAddSubmitting) {
      return
    }

    const raw = customAddModelId.trim().replaceAll('，', ',')
    if (!raw) {
      return
    }

    setCustomAddSubmitting(true)
    try {
      const useNewApiEndpoints = isNewApiProvider(provider)
      const defaultEndpoint = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS as EndpointType

      const addOne = async (singleId: string) => {
        if (existingModels.some((m) => m.id.endsWith(`::${singleId}`))) {
          window.toast.error(t('error.model.exists'))
          return false
        }

        await createModel({
          providerId,
          modelId: singleId,
          name: singleId.toUpperCase(),
          group: getDefaultGroupName(singleId, provider.id),
          endpointTypes: useNewApiEndpoints ? [defaultEndpoint] : undefined
        })

        return true
      }

      if (raw.includes(',')) {
        for (const id of splitModelIds(raw)) {
          if (!(await addOne(id))) {
            return
          }
        }
      } else {
        if (!(await addOne(raw))) {
          return
        }
      }

      // `createModel` already invalidates the `/models` SWR cache via its
      // `refresh: ['/models']` option, so an explicit refetch here would be a
      // duplicate revalidation. `loadModels` is independent — it refreshes the
      // remote browse list, not the local existing-models query.
      await loadModels(provider)
      setCustomAddExpanded(false)
      setCustomAddModelId('')
    } catch (error) {
      logger.error('Failed to add custom model from inline form', { providerId, error })
    } finally {
      setCustomAddSubmitting(false)
    }
  }, [createModel, customAddModelId, customAddSubmitting, existingModels, loadModels, provider, providerId, t])

  const onAddModel = useCallback(
    async (model: Model) => {
      if (isEmpty(model.name) || !provider) {
        return
      }

      if (isNewApiProvider(provider)) {
        const endpointTypes = model.endpointTypes
        if (endpointTypes && endpointTypes.length > 0) {
          await createModel(toCreateModelDto(providerId, model, endpointTypes))
        } else {
          setCustomAddModelId(getModelApiId(model))
          setCustomAddExpanded(true)
          window.setTimeout(() => {
            customAddInputRef.current?.focus()
          }, 0)
        }
        return
      }

      await createModel(toCreateModelDto(providerId, model))
    },
    [createModel, provider, providerId]
  )

  const onRemoveModel = useCallback(
    async (model: Model) => {
      const { modelId } = parseUniqueModelId(model.id)
      await deleteModel(providerId, modelId)
    },
    [deleteModel, providerId]
  )

  const onEnableAllInProvider = useCallback(async () => {
    if (existingModels.length === 0) {
      return
    }
    try {
      // Atomic batch via PATCH /models — `useModelMutations` already refreshes
      // the `/models` SWR cache on success, so an explicit refetch would be a
      // duplicate revalidation here.
      await updateModels(existingModels.map((m) => ({ uniqueModelId: m.id, patch: { isEnabled: true } })))
    } catch (error) {
      logger.error('Failed to enable all models for provider', { providerId, error })
    }
  }, [existingModels, providerId, updateModels])

  const onDisableAllInProvider = useCallback(async () => {
    if (existingModels.length === 0) {
      return
    }
    try {
      await updateModels(existingModels.map((m) => ({ uniqueModelId: m.id, patch: { isEnabled: false } })))
    } catch (error) {
      logger.error('Failed to disable all models for provider', { providerId, error })
    }
  }, [existingModels, providerId, updateModels])

  const onToggleModelEnabled = useCallback(
    async (model: Model, enabled: boolean) => {
      const { modelId } = parseUniqueModelId(model.id)
      // `updateModel` already invalidates the `/models` SWR cache via its
      // `refresh: ['/models']` option, so no explicit refetch is needed.
      await updateModel(providerId, modelId, { isEnabled: enabled })
    },
    [providerId, updateModel]
  )

  const enabledInProviderCount = useMemo(() => existingModels.filter((m) => m.isEnabled).length, [existingModels])
  const allEnabledInProvider = existingModels.length > 0 && existingModels.every((m) => m.isEnabled)
  const allDisabledInProvider = existingModels.length > 0 && existingModels.every((m) => !m.isEnabled)

  const panelTitle: ReactNode = useMemo(() => {
    if (!provider) {
      return t('settings.models.list_title')
    }

    return (
      <div className="flex w-full min-w-0 flex-shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-foreground text-sm">
            {t('settings.models.manage.drawer_title')}
          </span>
          <span className={modelListClasses.manageDrawerCountBadge}>
            {enabledInProviderCount} / {existingModels.length}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            disabled={loadingModels || existingModels.length === 0 || allEnabledInProvider}
            className={cn(
              modelListClasses.manageDrawerBulkGhost,
              modelListClasses.manageDrawerBulkGhostEnableHover,
              '!text-muted-foreground/60'
            )}
            onClick={() => void onEnableAllInProvider()}>
            {t('settings.models.bulk_enable')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={loadingModels || existingModels.length === 0 || allDisabledInProvider}
            className={cn(
              modelListClasses.manageDrawerBulkGhost,
              modelListClasses.manageDrawerBulkGhostDisableHover,
              '!text-muted-foreground/60'
            )}
            onClick={() => void onDisableAllInProvider()}>
            {t('settings.models.bulk_disable')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('common.close')}
            className={modelListClasses.manageDrawerCloseInTitle}
            onClick={onClose}>
            <X size={11} aria-hidden />
          </Button>
        </div>
      </div>
    )
  }, [
    allDisabledInProvider,
    allEnabledInProvider,
    enabledInProviderCount,
    existingModels.length,
    loadingModels,
    onDisableAllInProvider,
    onEnableAllInProvider,
    onClose,
    provider,
    t
  ])

  const panelFooter: ReactNode = (
    <ProviderActions className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        className={cn(modelListClasses.fetchOutline, '!h-auto !min-h-0 text-xs')}
        disabled={loadingModels || !provider}
        onClick={() => {
          if (provider) {
            void loadModels(provider)
          }
        }}>
        <RefreshCw size={10} aria-hidden />
        {t('settings.models.manage.reload_catalog')}
      </Button>
      <div className="min-w-0 flex-1" />
      <Button type="button" className="!shadow-none h-auto min-h-0 px-3 py-1 text-xs" onClick={onClose}>
        {t('settings.models.manage.footer_done')}
      </Button>
    </ProviderActions>
  )

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={panelTitle}
      footer={panelFooter}
      size="manage"
      showHeaderCloseButton={false}
      bodyClassName="min-h-0 flex-1 flex-col overflow-hidden !gap-0 !py-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 pt-3 pb-1.5">
          <div className={modelListClasses.searchWrap}>
            <Search className={modelListClasses.searchIcon} aria-hidden />
            <input
              ref={searchInputRef}
              value={searchText}
              disabled={loadingModels}
              placeholder={t('settings.models.manage.search_models_placeholder')}
              className={modelListClasses.searchInput}
              onChange={(event) => {
                onSearchInputChange(event.target.value)
              }}
            />
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1.5 pb-2">
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                { key: 'all' as const, label: t('settings.models.manage.status_all') },
                { key: 'enabled' as const, label: t('settings.models.manage.status_enabled') },
                { key: 'disabled' as const, label: t('settings.models.manage.status_disabled') }
              ] as const
            ).map((item) => (
              <Button
                key={item.key}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  modelListClasses.manageDrawerFilterChipBase,
                  optimisticStatusFilter === item.key
                    ? modelListClasses.manageDrawerFilterChipActive
                    : modelListClasses.manageDrawerFilterChipIdle
                )}
                onClick={() => setStatusFilterKey(item.key)}>
                {item.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {manageCapabilityFilters.map(({ key, label, Icon }) => (
              <Button
                key={key}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  modelListClasses.manageDrawerCapChipBase,
                  optimisticFilterType === key
                    ? modelListClasses.manageDrawerCapChipActive
                    : modelListClasses.manageDrawerCapChipIdle
                )}
                onClick={() => setCapabilityFilterKey(key)}>
                <Icon className="size-2 min-[380px]:size-2.5" aria-hidden />
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {browseLoading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
              <LoadingIcon color="var(--color-muted-foreground)" />
            </div>
          ) : null}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {isEmpty(list) ? (
                <div
                  className={cn(
                    modelListClasses.emptyState,
                    'min-h-32 border-none bg-transparent py-8 text-[length:var(--font-size-body-sm)]'
                  )}>
                  {t('settings.models.empty')}
                </div>
              ) : (
                <ManageModelsList
                  modelGroups={modelGroups}
                  provider={provider!}
                  existingModelIds={existingModelIds}
                  existingById={existingById}
                  onAddModel={(model) => void onAddModel(model)}
                  onRemoveModel={(model) => void onRemoveModel(model)}
                  onToggleModelEnabled={(model, enabled) => void onToggleModelEnabled(model, enabled)}
                />
              )}
            </div>

            <div className="mt-1 shrink-0 px-1 pt-2">
              {customAddExpanded && provider ? (
                <div className="flex items-center gap-1.5 rounded-xl border border-cherry-primary/20 bg-cherry-active-bg px-2.5 py-2">
                  <input
                    ref={customAddInputRef}
                    value={customAddModelId}
                    disabled={customAddSubmitting || loadingModels}
                    placeholder={t('settings.models.add.model_id.placeholder')}
                    spellCheck={false}
                    maxLength={200}
                    aria-label={t('settings.models.add.model_id.label')}
                    className="min-w-0 flex-1 border-none bg-transparent p-0 text-foreground text-xs shadow-none outline-none ring-0 placeholder:text-muted-foreground/60 focus-visible:ring-0"
                    onChange={(event) => setCustomAddModelId(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void submitInlineCustomModel()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelInlineCustomModel()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={customAddSubmitting || loadingModels}
                    className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                    aria-label={t('common.confirm')}
                    onClick={() => void submitInlineCustomModel()}>
                    <Check className="size-3.5" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={customAddSubmitting}
                    className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                    aria-label={t('common.cancel')}
                    onClick={cancelInlineCustomModel}>
                    <X className="size-3.5" aria-hidden />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={loadingModels || !provider}
                  onClick={() => {
                    setCustomAddExpanded(true)
                    setCustomAddModelId('')
                    window.setTimeout(() => {
                      customAddInputRef.current?.focus()
                    }, 0)
                  }}
                  className="h-auto w-full justify-center gap-1.5 rounded-xl border border-[color:var(--section-border)] border-dashed py-2 text-muted-foreground/60 text-xs shadow-none hover:border-[color:var(--color-border)] hover:text-foreground">
                  <Plus size={10} />
                  {t('settings.models.manage.add_custom_model')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </ProviderSettingsDrawer>
  )
}
