import { ChevronDown, ChevronUp, CircleHelp } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Switch, Tooltip } from '@cherrystudio/ui'
import CopyIcon from '@renderer/components/icons/CopyIcon'
import { useModelMutations } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { getDefaultGroupName } from '@renderer/utils/naming'
import type { UpdateModelDto } from '@shared/data/api/schemas/models'
import { type EndpointType, type Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'

import ProviderActions from '../../primitives/ProviderActions'
import ProviderSection from '../../primitives/ProviderSection'
import ProviderSettingsDrawer from '../../primitives/ProviderSettingsDrawer'
import { drawerClasses, fieldClasses, ProviderHelpText } from '../../primitives/ProviderSettingsPrimitives'
import { getModelApiId } from './helpers'
import { ModelBasicFields } from './ModelBasicFields'
import { ModelContextWindowFields } from './ModelContextWindowFields'
import { ModelMetadataControls } from './ModelMetadataControls'
import { ModelPricingFields } from './ModelPricingFields'
import type { ModelMetadata } from './types'

interface EditModelDrawerProps {
  providerId: string
  open: boolean
  model: Model | null
  onClose: () => void
}

interface AutoSaveQueueItem {
  providerId: string
  modelId: string
  patch: UpdateModelDto
}

export default function EditModelDrawer({ providerId, open, model: modelProp, onClose }: EditModelDrawerProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { updateModel } = useModelMutations()
  // Keep the last opened model around so `PageSidePanel`'s exit animation has stable content
  // after the parent clears its `editingModel` selection on close.
  const previousModelRef = useRef<Model | null>(modelProp)
  if (modelProp) {
    previousModelRef.current = modelProp
  }
  const model = modelProp ?? previousModelRef.current
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [endpointTypes, setEndpointTypes] = useState<EndpointType[]>([])
  const [showMoreSettings, setShowMoreSettings] = useState(true)
  const [metadata, setMetadata] = useState<ModelMetadata>({ capabilities: [] })
  const [supportsStreaming, setSupportsStreaming] = useState<Model['supportsStreaming']>(true)
  const [contextWindow, setContextWindow] = useState<number | null>(null)
  const [maxInputTokens, setMaxInputTokens] = useState<number | null>(null)
  const [maxOutputTokens, setMaxOutputTokens] = useState<number | null>(null)
  const [pricing, setPricing] = useState<Model['pricing']>()
  const [initializedModel, setInitializedModel] = useState<Model | null>(null)
  const autoSavePendingItemsRef = useRef(new Map<string, AutoSaveQueueItem>())
  const autoSaveRunningRef = useRef(false)

  const apiModelId = useMemo(() => (model ? getModelApiId(model) : ''), [model])

  useLayoutEffect(() => {
    if (!open || !model) {
      return
    }

    setName(model.name)
    setGroup(model.group ?? '')
    setEndpointTypes(model.endpointTypes?.length ? [...model.endpointTypes] : [])
    setMetadata({
      capabilities: model.capabilities,
      inputModalities: model.inputModalities,
      outputModalities: model.outputModalities
    })
    setShowMoreSettings(true)
    setSupportsStreaming(model.supportsStreaming)
    setContextWindow(model.contextWindow ?? null)
    setMaxInputTokens(model.maxInputTokens ?? null)
    setMaxOutputTokens(model.maxOutputTokens ?? null)
    setPricing(model.pricing)
    setInitializedModel(model)
  }, [model, open])

  const handleUpdateModel = useCallback(
    async ({ providerId, modelId, patch }: AutoSaveQueueItem) => {
      await updateModel(providerId, modelId, patch)
    },
    [updateModel]
  )

  const processAutoSaveQueue = useCallback(async () => {
    if (autoSaveRunningRef.current) {
      return
    }

    autoSaveRunningRef.current = true
    try {
      while (autoSavePendingItemsRef.current.size > 0) {
        const [key, item] = autoSavePendingItemsRef.current.entries().next().value!
        autoSavePendingItemsRef.current.delete(key)

        try {
          await handleUpdateModel(item)
        } catch {
          toast.error(t('common.error'))
        }
      }
    } finally {
      autoSaveRunningRef.current = false
    }
  }, [handleUpdateModel, t])

  const autoSave = useCallback(
    (patch: UpdateModelDto) => {
      if (!model) {
        return
      }

      const { modelId } = parseUniqueModelId(model.id)
      const item: AutoSaveQueueItem = {
        providerId: model.providerId ?? providerId,
        modelId,
        patch
      }
      const queueKey = `${item.providerId}/${item.modelId}`
      const pendingItem = autoSavePendingItemsRef.current.get(queueKey)
      autoSavePendingItemsRef.current.set(
        queueKey,
        pendingItem ? { ...item, patch: { ...pendingItem.patch, ...item.patch } } : item
      )
      void processAutoSaveQueue()
    },
    [model, processAutoSaveQueue, providerId]
  )

  const handlePricingCommit = useCallback(
    (pricing: NonNullable<Model['pricing']>) => {
      setPricing(pricing)
      autoSave({ pricing })
    },
    [autoSave]
  )

  if (!provider || !model) {
    return <ProviderSettingsDrawer open={open} onClose={onClose} title={t('models.edit')} />
  }

  if (initializedModel !== model) {
    return <ProviderSettingsDrawer open={open} onClose={onClose} title={t('models.edit')} />
  }

  return (
    <ProviderSettingsDrawer open={open} onClose={onClose} title={t('models.edit')}>
      <form
        id="provider-settings-model-edit-form"
        data-testid="provider-settings-model-edit-drawer-content"
        className="flex min-h-0 flex-col gap-4 py-0"
        onSubmit={(event) => event.preventDefault()}>
        <ProviderSection className={drawerClasses.section}>
          <div className={drawerClasses.fieldList}>
            <ModelBasicFields
              values={{
                modelId: apiModelId,
                name,
                group,
                contextWindow,
                maxInputTokens,
                maxOutputTokens,
                endpointTypes
              }}
              showEndpointType
              endpointTypeControl="chips"
              modelIdDisabled
              modelIdAction={
                <button
                  type="button"
                  aria-label={t('message.copied')}
                  className={fieldClasses.inputActionButton}
                  onClick={() => {
                    void navigator.clipboard.writeText(apiModelId)
                    toast.success(t('message.copied'))
                  }}>
                  <CopyIcon size={14} />
                </button>
              }
              onModelIdChange={(value) => {
                setName(value)
                setGroup(getDefaultGroupName(value))
              }}
              onNameChange={setName}
              onNameBlur={() => {
                if (name !== model.name) autoSave({ name: name || model.name })
              }}
              onGroupChange={setGroup}
              onGroupBlur={() => {
                if (group !== (model.group ?? '')) autoSave({ group })
              }}
              onEndpointTypesChange={(next) => {
                const nextEndpointTypes = [...next]
                setEndpointTypes(nextEndpointTypes)
                autoSave({ endpointTypes: nextEndpointTypes })
              }}
            />
          </div>
        </ProviderSection>

        <ProviderActions>
          <Button
            type="button"
            variant="ghost"
            className={drawerClasses.toggleButton}
            onClick={() => setShowMoreSettings((current) => !current)}>
            {t('settings.moresetting.label')}
            {showMoreSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>
        </ProviderActions>

        {showMoreSettings && (
          <ProviderSection className={drawerClasses.section}>
            <div data-testid="provider-settings-model-more-settings" className="space-y-4">
              <div className={drawerClasses.sectionCard}>
                <ModelMetadataControls
                  value={metadata}
                  onChange={(patch) => {
                    setMetadata((current) => ({ ...current, ...patch }))
                    autoSave(patch)
                  }}
                />
                <ProviderHelpText className="mt-2">
                  {t('settings.models.edit.classification_save_hint')}
                </ProviderHelpText>
              </div>

              <div className={drawerClasses.sectionCard}>
                <ModelContextWindowFields
                  contextWindow={contextWindow}
                  maxInputTokens={maxInputTokens}
                  maxOutputTokens={maxOutputTokens}
                  onContextWindowChange={setContextWindow}
                  // The committed value is passed through rather than read back
                  // from state, which has not re-rendered yet at this point.
                  onContextWindowCommit={(contextWindow) => autoSave({ contextWindow })}
                  onMaxInputTokensChange={setMaxInputTokens}
                  onMaxInputTokensCommit={(maxInputTokens) => autoSave({ maxInputTokens })}
                  onMaxOutputTokensChange={setMaxOutputTokens}
                  onMaxOutputTokensCommit={(maxOutputTokens) => autoSave({ maxOutputTokens })}
                />
              </div>

              <div className={drawerClasses.switchCard}>
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-normal text-[13px] text-muted-foreground leading-5">
                      {t('settings.models.add.supported_text_delta.label')}
                    </span>
                    <Tooltip content={t('settings.models.add.supported_text_delta.tooltip')}>
                      <span className="inline-flex h-5 w-4 shrink-0 items-center justify-center text-muted-foreground">
                        <CircleHelp aria-hidden className="size-3" />
                      </span>
                    </Tooltip>
                  </div>
                  <Switch
                    size="sm"
                    aria-label={t('settings.models.add.supported_text_delta.label')}
                    checked={supportsStreaming ?? false}
                    onCheckedChange={(checked) => {
                      setSupportsStreaming(checked)
                      autoSave({ supportsStreaming: checked })
                    }}
                  />
                </div>
              </div>

              <div className={drawerClasses.sectionCard}>
                <ModelPricingFields
                  key={`${providerId}:${model.id}`}
                  pricing={pricing}
                  onCommit={handlePricingCommit}
                />
              </div>
            </div>
          </ProviderSection>
        )}
      </form>
    </ProviderSettingsDrawer>
  )
}
