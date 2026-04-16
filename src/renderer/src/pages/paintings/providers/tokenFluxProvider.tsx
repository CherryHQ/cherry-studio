import {
  InfoTooltip,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Tooltip
} from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { useAllProviders } from '@renderer/hooks/useProvider'
import FileManager from '@renderer/services/FileManager'
import type { TokenFluxPainting } from '@renderer/types'
import { uuid } from '@renderer/utils'
import type { TFunction } from 'i18next'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink } from '../../settings'
import Artboard from '../components/Artboard'
import { DynamicFormRender } from '../components/DynamicFormRender'
import PaintingsSectionTitle from '../components/PaintingsSectionTitle'
import { DEFAULT_TOKENFLUX_PAINTING, type TokenFluxModel } from '../config/tokenFluxConfig'
import { checkProviderEnabled } from '../utils'
import { runGeneration } from '../utils/runGeneration'
import TokenFluxService from '../utils/TokenFluxService'
import type { GenerateContext, PaintingProviderDefinition } from './types'

/**
 * Read i18n-aware field from a schema property.
 * Falls back to the base key if no localized version exists.
 */
function readI18nContext(property: Record<string, any>, key: string, lang: string): string {
  return property[`${key}_${lang}`] || property[key]
}

// ---- Sidebar extra: model select + dynamic schema form ----

interface TokenFluxSidebarProps {
  painting: TokenFluxPainting
  isLoading: boolean
  patchPainting: (updates: Partial<TokenFluxPainting>) => void
  modelOptions: Array<{ value: string; label: string; group?: string; [k: string]: any }>
  t: TFunction
}

const TokenFluxSidebar: FC<TokenFluxSidebarProps> = ({ painting, patchPainting, modelOptions, t }) => {
  const { i18n } = useTranslation()
  const lang = i18n.language.split('-')[0]

  // Recover full model objects from modelOptions (they carry _raw with the full TokenFluxModel)
  const models: TokenFluxModel[] = useMemo(
    () => modelOptions.map((o) => o._raw as TokenFluxModel).filter(Boolean),
    [modelOptions]
  )

  const selectedModel = useMemo(() => models.find((m) => m.id === painting.model) || null, [models, painting.model])

  const formData: Record<string, any> = painting.inputParams || {}

  const handleFormFieldChange = (field: string, value: any) => {
    const newFormData = { ...formData, [field]: value }
    patchPainting({ inputParams: newFormData })
  }

  return (
    <>
      {/* Model & Pricing Section */}
      <PaintingsSectionTitle>
        {t('paintings.model_and_pricing')}
        {selectedModel?.pricing && (
          <div className="rounded border border-[var(--color-primary-border)] bg-[var(--color-primary-bg)] px-0 py-1 font-medium text-[11px] text-[var(--color-primary)]">
            {selectedModel.pricing.price} {selectedModel.pricing.currency}{' '}
            {selectedModel.pricing.unit > 1 ? t('paintings.per_images') : t('paintings.per_image')}
          </div>
        )}
      </PaintingsSectionTitle>

      <Select
        value={painting.model || ''}
        onValueChange={(modelId: string) => {
          patchPainting({ model: modelId, inputParams: {} })
        }}>
        <SelectTrigger className="mb-3 w-full">
          <SelectValue placeholder={t('paintings.select_model')} />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(
            models.reduce(
              (acc, model) => {
                const provider = model.model_provider || 'Other'
                if (!acc[provider]) acc[provider] = []
                acc[provider].push(model)
                return acc
              },
              {} as Record<string, TokenFluxModel[]>
            )
          ).map(([provider, providerModels]) => (
            <SelectGroup key={provider}>
              <SelectLabel>{provider}</SelectLabel>
              {providerModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  <Tooltip content={model.description}>
                    <div className="flex flex-col">
                      <div className="text-[var(--color-text)]">{model.name}</div>
                    </div>
                  </Tooltip>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      {/* Input Parameters Section */}
      {selectedModel?.input_schema && (
        <>
          <PaintingsSectionTitle>{t('paintings.input_parameters')}</PaintingsSectionTitle>
          <div className="flex flex-col gap-3">
            {Object.entries(selectedModel.input_schema.properties).map(([key, property]: [string, any]) => {
              if (key === 'prompt') return null

              const isRequired = selectedModel.input_schema.required?.includes(key)

              return (
                <div key={key} className="flex flex-col">
                  <div className="mb-1.5 flex items-center">
                    <span className="font-medium text-[13px] text-[var(--color-text)] capitalize">
                      {readI18nContext(property, 'title', lang)}
                      {isRequired && <span className="font-semibold text-[var(--color-error)]"> *</span>}
                    </span>
                    {property.description && <InfoTooltip content={readI18nContext(property, 'description', lang)} />}
                  </div>
                  <DynamicFormRender
                    schemaProperty={property}
                    propertyName={key}
                    value={formData[key]}
                    onChange={handleFormFieldChange}
                  />
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

// ---- Provider definition ----

export const tokenFluxProvider: PaintingProviderDefinition<TokenFluxPainting> = {
  providerId: 'tokenflux',

  // Model loading: async fetch from TokenFluxService.
  // We store the full TokenFluxModel in `_raw` so sidebarExtra can access schemas.
  models: {
    type: 'dynamic',
    resolver: () => {
      // Dynamic resolver runs synchronously, so we return empty initially.
      // Actual loading happens via the async effect below exposed through sidebarExtra.
      return []
    }
  },

  // No static config fields -- everything is dynamic via sidebarExtra
  configFields: [],

  getDefaultPainting: () => ({
    ...DEFAULT_TOKENFLUX_PAINTING,
    id: uuid()
  }),

  onModelChange: (modelId) => ({ model: modelId, inputParams: {} }),

  showTranslate: true,

  providerHeaderExtra: (_provider, t) => {
    const Icon = resolveProviderIcon('tokenflux')
    return (
      <SettingHelpLink target="_blank" href="https://tokenflux.ai">
        {t('paintings.learn_more')}
        {Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null}
      </SettingHelpLink>
    )
  },

  sidebarExtra: (state) => {
    return <TokenFluxSidebarWrapper state={state} />
  },

  centerContent: (state) => {
    return <TokenFluxCenterContent state={state} />
  },

  async onGenerate(ctx: GenerateContext<TokenFluxPainting>) {
    const { painting, provider, abortController, patchPainting, setFallbackUrls, t } = ctx

    await checkProviderEnabled(provider, t)

    if (painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })
      if (!confirmed) return
      await FileManager.deleteFiles(painting.files)
    }

    const prompt = painting.prompt || ''

    if (!painting.model || !prompt) {
      window.modal.error({
        content: t('paintings.text_desc_required'),
        centered: true
      })
      return
    }

    await runGeneration(ctx, async () => {
      const tokenFluxService = new TokenFluxService(provider.apiHost, provider.apiKey)
      const formData = painting.inputParams || {}

      const requestBody = {
        model: painting.model,
        input: {
          prompt,
          ...formData
        }
      }

      const inputParams = { prompt, ...formData }
      patchPainting({
        model: painting.model,
        prompt,
        status: 'processing',
        inputParams
      })

      const result = await tokenFluxService.generateAndWait(requestBody, {
        signal: abortController.signal,
        onStatusUpdate: (updates) => {
          patchPainting(updates)
        }
      })

      if (result?.images && result.images.length > 0) {
        const urls = result.images.map((img: { url: string }) => img.url)
        const validFiles = await tokenFluxService.downloadImages(urls)
        patchPainting({ status: 'succeeded' })
        setFallbackUrls(urls)
        return { files: validFiles }
      }
    })
  }
}

// ---- Wrapper components (hooks must be called from React components) ----

/**
 * Wrapper that loads models asynchronously and renders the sidebar.
 * This is needed because the model list must be fetched from TokenFluxService
 * which requires provider.apiHost and apiKey at runtime.
 */
const TokenFluxSidebarWrapper: FC<{ state: any }> = ({ state }) => {
  const { painting, isLoading, patchPainting, t } = state
  const [models, setModels] = useState<TokenFluxModel[]>([])
  const providers = useAllProviders()
  const provider = providers.find((p) => p.id === 'tokenflux')

  useEffect(() => {
    const service = new TokenFluxService(provider?.apiHost ?? '', provider?.apiKey ?? '')
    void service
      .fetchModels()
      .then(setModels)
      .catch(() => setModels([]))
  }, [provider?.apiHost, provider?.apiKey])

  // Convert to ModelOption-like objects with _raw for full model data
  const modelOptions = useMemo(
    () =>
      models.map((m) => ({
        label: m.name,
        value: m.id,
        group: m.model_provider,
        _raw: m
      })),
    [models]
  )

  return (
    <TokenFluxSidebar
      painting={painting}
      isLoading={isLoading}
      patchPainting={patchPainting}
      modelOptions={modelOptions}
      t={t}
    />
  )
}

/**
 * Center content with split view when formData contains image fields.
 */
const TokenFluxCenterContent: FC<{ state: any }> = ({ state }) => {
  const { painting, isLoading, currentImageIndex, prevImage, nextImage, onCancel, t } = state
  const formData: Record<string, any> = painting.inputParams || {}

  const hasImageInput = Object.keys(formData).some((key) => key.toLowerCase().includes('image') && formData[key])

  if (!hasImageInput) {
    return (
      <Artboard
        painting={painting}
        isLoading={isLoading}
        currentImageIndex={currentImageIndex}
        onPrevImage={prevImage}
        onNextImage={nextImage}
        onCancel={onCancel}
      />
    )
  }

  return (
    <div className="flex h-full flex-1 flex-row gap-px">
      <div className="flex h-full flex-1 flex-col border-[var(--color-border)] border-r bg-[var(--color-background)]">
        <div className="border-[var(--color-border)] border-b bg-[var(--color-background-soft)] px-5 py-2.5 text-center font-medium text-[14px] text-[var(--color-text-2)]">
          {t('paintings.input_image')}
        </div>
        <div className="flex flex-1 items-center justify-center bg-[var(--color-background)]">
          {Object.entries(formData).map(([key, value]) => {
            if (key.toLowerCase().includes('image') && value) {
              return (
                <div key={key} className="relative flex items-center justify-center">
                  <img
                    src={value}
                    alt={t('paintings.uploaded_input')}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '70vh',
                      objectFit: 'contain',
                      backgroundColor: 'var(--color-background-soft)'
                    }}
                  />
                </div>
              )
            }
            return null
          })}
        </div>
      </div>
      <div className="flex h-full flex-1 flex-col bg-[var(--color-background)]">
        <div className="border-[var(--color-border)] border-b bg-[var(--color-background-soft)] px-5 py-2.5 text-center font-medium text-[14px] text-[var(--color-text-2)]">
          {t('paintings.generated_image')}
        </div>
        <Artboard
          painting={painting}
          isLoading={isLoading}
          currentImageIndex={currentImageIndex}
          onPrevImage={prevImage}
          onNextImage={nextImage}
          onCancel={onCancel}
        />
      </div>
    </div>
  )
}
