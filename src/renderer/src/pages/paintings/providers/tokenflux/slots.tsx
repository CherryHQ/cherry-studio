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
import { useAllProviders } from '@renderer/hooks/useProvider'
import type { TFunction } from 'i18next'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Artboard from '../../components/Artboard'
import PaintingsSectionTitle from '../../components/PaintingsSectionTitle'
import { SchemaValueField } from '../../form/fields/SchemaField'
import type { TokenFluxPaintingData as TokenFluxPainting } from '../../model/types/paintingData'
import type { CenterSlotState, SidebarSlotState } from '../types'
import type { TokenFluxModel } from './config'
import TokenFluxService from './service'

function readI18nContext(property: Record<string, any>, key: string, lang: string): string {
  return property[`${key}_${lang}`] || property[key]
}

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

  const models: TokenFluxModel[] = useMemo(
    () => modelOptions.map((option) => option._raw as TokenFluxModel).filter(Boolean),
    [modelOptions]
  )

  const selectedModel = useMemo(
    () => models.find((model) => model.id === painting.model) || null,
    [models, painting.model]
  )
  const formData: Record<string, any> = painting.inputParams || {}

  const handleFormFieldChange = (field: string, value: any) => {
    const newFormData = { ...formData, [field]: value }
    patchPainting({ inputParams: newFormData })
  }

  return (
    <>
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
                  <SchemaValueField
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

export const TokenFluxSidebarWrapper: FC<{ state: SidebarSlotState<TokenFluxPainting> }> = ({ state }) => {
  const { painting, isLoading, patchPainting, t } = state
  const [models, setModels] = useState<TokenFluxModel[]>([])
  const providers = useAllProviders()
  const provider = providers.find((item) => item.id === 'tokenflux')

  useEffect(() => {
    const service = new TokenFluxService(provider?.apiHost ?? '', provider?.apiKey ?? '')
    void service
      .fetchModels()
      .then(setModels)
      .catch(() => setModels([]))
  }, [provider?.apiHost, provider?.apiKey])

  const modelOptions = useMemo(
    () =>
      models.map((model) => ({
        label: model.name,
        value: model.id,
        group: model.model_provider,
        _raw: model
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

export const TokenFluxCenterContent: FC<{ state: CenterSlotState<TokenFluxPainting> }> = ({ state }) => {
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

export {
  TokenFluxCenterContent as renderTokenFluxCenterContent,
  TokenFluxSidebarWrapper as renderTokenFluxSidebarExtra
}
