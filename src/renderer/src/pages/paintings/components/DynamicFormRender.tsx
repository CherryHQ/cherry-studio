import { Button, Switch, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { convertToBase64 } from '@renderer/utils'
import { Link, RefreshCw, Upload, X } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import type { DynamicFormSchemaProperty, DynamicFormValue } from '../providers/types'
import { FilePicker, NumberField, TextInput } from './PaintingControls'
import PaintingSelect from './PaintingSelect'

interface DynamicFormRenderProps {
  schemaProperty: DynamicFormSchemaProperty
  propertyName: string
  value: DynamicFormValue
  onChange: (field: string, value: DynamicFormValue) => void
}

const logger = loggerService.withContext('DynamicFormRender')

export const DynamicFormRender: React.FC<DynamicFormRenderProps> = ({
  schemaProperty,
  propertyName,
  value,
  onChange
}) => {
  const { t } = useTranslation()
  const { type, enum: enumValues, description, default: defaultValue, format } = schemaProperty

  const handleImageUpload = useCallback(
    async (
      propertyName: string,
      fileOrUrl: File | string,
      onChange: (field: string, value: DynamicFormValue) => void
    ): Promise<void> => {
      try {
        if (typeof fileOrUrl === 'string') {
          // Handle URL case - validate and set directly
          if (fileOrUrl.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i)) {
            onChange(propertyName, fileOrUrl)
          } else {
            window.toast?.error(t('common.invalid_image_url'))
          }
        } else {
          // Handle File case - convert to base64
          const base64Image = await convertToBase64(fileOrUrl)
          if (typeof base64Image === 'string') {
            onChange(propertyName, base64Image)
          } else {
            logger.error('Failed to convert image to base64')
          }
        }
      } catch (error) {
        logger.error('Error processing image:', error as Error)
      }
    },
    [t]
  )

  if (type === 'string' && propertyName.toLowerCase().includes('image') && format === 'uri') {
    const imageValue = typeof value === 'string' ? value : ''
    const inputValue = imageValue || (typeof defaultValue === 'string' ? defaultValue : '')

    return (
      <div className="flex flex-col gap-3">
        <div className="flex">
          <TextInput
            className="rounded-r-none border-r-0"
            value={inputValue}
            onChange={(e) => onChange(propertyName, e.target.value)}
            placeholder={t('common.image_url_or_upload')}
            prefix={<Link className="size-4 text-foreground-muted" />}
          />
          <FilePicker
            accept="image/*"
            className="rounded-l-none"
            onFiles={(files) => {
              const file = files[0]
              if (file) {
                void handleImageUpload(propertyName, file, onChange)
              }
            }}>
            <Button title={t('common.upload_image')} className="h-8 rounded-l-none">
              <Upload className="size-4" />
            </Button>
          </FilePicker>
        </div>

        {imageValue && (
          <div className="flex items-center gap-2 rounded-[6px] border border-border bg-(--color-fill-quaternary) p-2">
            <img
              src={imageValue}
              alt={t('common.image_preview')}
              className="h-12 w-12 shrink-0 rounded border border-(--color-border-secondary) object-cover shadow-[0_1px_4px_rgba(0,0,0,0.1)]"
            />
            <div className="min-w-0 flex-1 overflow-hidden text-ellipsis text-foreground-secondary text-xs">
              {imageValue.startsWith('data:') ? t('common.uploaded_image') : t('common.image_url')}
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onChange(propertyName, '')}
              title={t('common.remove_image')}
              className="min-w-0 shrink-0 px-2">
              <X className="size-4" />
            </Button>
          </div>
        )}
      </div>
    )
  }

  if (type === 'string' && enumValues) {
    return (
      <PaintingSelect
        className="w-full"
        value={(value || defaultValue) as string | number | undefined}
        options={enumValues.map((val: string) => ({ label: val, value: val }))}
        onChange={(v) => onChange(propertyName, v)}
      />
    )
  }

  if (type === 'string') {
    const stringValue = typeof value === 'string' ? value : typeof defaultValue === 'string' ? defaultValue : ''

    if (propertyName.toLowerCase().includes('prompt') && propertyName !== 'prompt') {
      return (
        <Textarea.Input
          value={stringValue}
          onChange={(e) => onChange(propertyName, e.target.value)}
          rows={3}
          placeholder={description}
        />
      )
    }
    return (
      <TextInput
        value={stringValue}
        onChange={(e) => onChange(propertyName, e.target.value)}
        placeholder={description}
      />
    )
  }

  if (type === 'integer' && propertyName === 'seed') {
    const generateRandomSeed = () => Math.floor(Math.random() * 1000000)
    const numericValue = typeof value === 'number' ? value : typeof defaultValue === 'number' ? defaultValue : undefined

    return (
      <div className="flex items-center gap-2">
        <NumberField
          className="flex-1"
          value={numericValue}
          onChange={(v) => onChange(propertyName, v)}
          step={1}
          min={schemaProperty.minimum}
          max={schemaProperty.maximum}
        />
        <Button
          size="sm"
          onClick={() => onChange(propertyName, generateRandomSeed())}
          title={t('common.generate_random_seed')}>
          <RefreshCw className="size-4" />
        </Button>
      </div>
    )
  }

  if (type === 'integer' || type === 'number') {
    const step = type === 'number' ? 0.1 : 1
    const numericValue = typeof value === 'number' ? value : typeof defaultValue === 'number' ? defaultValue : undefined

    return (
      <NumberField
        className="w-full"
        value={numericValue}
        onChange={(v) => onChange(propertyName, v)}
        step={step}
        min={schemaProperty.minimum}
        max={schemaProperty.maximum}
      />
    )
  }

  if (type === 'boolean') {
    const checked = typeof value === 'boolean' ? value : typeof defaultValue === 'boolean' ? defaultValue : false

    return <Switch checked={checked} onCheckedChange={(checked) => onChange(propertyName, checked)} className="w-0.5" />
  }

  return null
}
