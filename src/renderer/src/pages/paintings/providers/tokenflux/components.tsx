import { InfoTooltip } from '@cherrystudio/ui'
import type { TFunction } from 'i18next'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import Artboard from '../../components/Artboard'
import PaintingsSectionTitle from '../../components/PaintingsSectionTitle'
import { SchemaValueField } from '../../form/fields/SchemaField'
import type { ModelOption } from '../../hooks/useModelLoader'
import type { TokenFluxPaintingData as TokenFluxPainting } from '../../model/types/paintingData'
import type { TokenFluxModel } from './config'

function readI18nContext(property: Record<string, any>, key: string, lang: string): string {
  return property[`${key}_${lang}`] || property[key]
}

export const TokenFluxSidebarContent: FC<{
  painting: TokenFluxPainting
  patchPainting: (updates: Partial<TokenFluxPainting>) => void
  modelOptions: ModelOption[]
  t: TFunction
}> = ({ painting, patchPainting, modelOptions, t }) => {
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
          <div className="ml-auto rounded border border-[var(--color-primary-border)] bg-[var(--color-primary-bg)] px-0 py-1 font-medium text-[11px] text-[var(--color-primary)]">
            {selectedModel.pricing.price} {selectedModel.pricing.currency}{' '}
            {selectedModel.pricing.unit > 1 ? t('paintings.per_images') : t('paintings.per_image')}
          </div>
        )}
      </PaintingsSectionTitle>

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

export const TokenFluxCenterContent: FC<{
  painting: TokenFluxPainting
  isLoading: boolean
  onCancel: () => void
}> = ({ painting, isLoading, onCancel }) => {
  const { t } = useTranslation()
  const formData: Record<string, any> = painting.inputParams || {}
  const hasImageInput = Object.keys(formData).some((key) => key.toLowerCase().includes('image') && formData[key])

  if (!hasImageInput) {
    return <Artboard painting={painting} isLoading={isLoading} onCancel={onCancel} />
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
        <Artboard painting={painting} isLoading={isLoading} onCancel={onCancel} />
      </div>
    </div>
  )
}
