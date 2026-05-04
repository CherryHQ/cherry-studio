import { InfoTooltip } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import Artboard from '../../components/Artboard'
import PaintingSectionTitle from '../../components/PaintingSectionTitle'
import { SchemaValueField } from '../../form/fields/SchemaField'
import type { TokenFluxPaintingData as TokenFluxPainting } from '../../model/types/paintingData'
import type { TokenFluxModel } from './config'

function readI18nContext(property: Record<string, any>, key: string, lang: string): string {
  return property[`${key}_${lang}`] || property[key]
}

export const TokenFluxSetting: FC<{
  painting: TokenFluxPainting
  patchPainting: (updates: Partial<TokenFluxPainting>) => void
  selectedModel?: TokenFluxModel
}> = ({ painting, patchPainting, selectedModel }) => {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.split('-')[0]
  const formData: Record<string, any> = painting.inputParams || {}

  const handleFormFieldChange = (field: string, value: any) => {
    const newFormData = { ...formData, [field]: value }
    patchPainting({ inputParams: newFormData })
  }

  return (
    <>
      <PaintingSectionTitle>
        {t('paintings.model_and_pricing')}
        {selectedModel?.pricing && (
          <div className="ml-auto rounded border border-primary/20 bg-primary/10 px-0 py-1 font-medium text-[11px] text-primary">
            {selectedModel.pricing.price} {selectedModel.pricing.currency}{' '}
            {selectedModel.pricing.unit > 1 ? t('paintings.per_images') : t('paintings.per_image')}
          </div>
        )}
      </PaintingSectionTitle>

      {selectedModel?.input_schema && (
        <div className="flex flex-col gap-3">
          {Object.entries(selectedModel.input_schema.properties).map(([key, property]: [string, any]) => {
            if (key === 'prompt') return null

            const isRequired = selectedModel.input_schema.required?.includes(key)

            return (
              <div key={key} className="flex flex-col">
                <div className="mb-1.5 flex items-center">
                  <span className="font-medium text-[13px] text-foreground capitalize">
                    {readI18nContext(property, 'title', lang)}
                    {isRequired && <span className="font-semibold text-destructive"> *</span>}
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
      <div className="flex h-full flex-1 flex-col border-border border-r bg-background">
        <div className="border-border border-b bg-muted/30 px-5 py-2.5 text-center font-medium text-[14px] text-muted-foreground">
          {t('paintings.input_image')}
        </div>
        <div className="flex flex-1 items-center justify-center bg-background">
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
                      objectFit: 'contain'
                    }}
                    className="bg-muted/30"
                  />
                </div>
              )
            }
            return null
          })}
        </div>
      </div>
      <div className="flex h-full flex-1 flex-col bg-background">
        <div className="border-border border-b bg-muted/30 px-5 py-2.5 text-center font-medium text-[14px] text-muted-foreground">
          {t('paintings.generated_image')}
        </div>
        <Artboard painting={painting} isLoading={isLoading} onCancel={onCancel} />
      </div>
    </div>
  )
}
