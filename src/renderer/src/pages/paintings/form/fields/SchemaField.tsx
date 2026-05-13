import {
  Button,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { convertToBase64 } from '@renderer/utils'
import { Link2, RotateCcw, Upload, X } from 'lucide-react'
import { useCallback, useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { PaintingFieldComponentProps } from '../fieldRegistry'

interface SchemaValueFieldProps {
  schemaProperty: any
  propertyName: string
  value: any
  onChange: (field: string, value: any) => void
}

const logger = loggerService.withContext('SchemaField')

export function SchemaValueField({ schemaProperty, propertyName, value, onChange }: SchemaValueFieldProps) {
  const { t } = useTranslation()
  const uploadInputId = useId()
  const { type, enum: enumValues, description, default: defaultValue, format } = schemaProperty

  const handleImageUpload = useCallback(
    async (fileOrUrl: File | string): Promise<void> => {
      try {
        if (typeof fileOrUrl === 'string') {
          if (fileOrUrl.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i)) {
            onChange(propertyName, fileOrUrl)
          } else {
            window.toast?.error('Invalid image URL format')
          }
          return
        }

        const base64Image = await convertToBase64(fileOrUrl)
        if (typeof base64Image === 'string') {
          onChange(propertyName, base64Image)
        } else {
          logger.error('Failed to convert image to base64')
        }
      } catch (error) {
        logger.error('Error processing image:', error as Error)
      }
    },
    [onChange, propertyName]
  )

  if (type === 'string' && propertyName.toLowerCase().includes('image') && format === 'uri') {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <InputGroup className="flex-1">
            <InputGroupAddon>
              <Link2 size={14} />
            </InputGroupAddon>
            <InputGroupInput
              value={value || defaultValue || ''}
              onChange={(event) => onChange(propertyName, event.target.value)}
              placeholder={t('common.image_url_or_upload')}
            />
          </InputGroup>

          <input
            id={uploadInputId}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                void handleImageUpload(file)
              }
              event.target.value = ''
            }}
          />
          <Button type="button" variant="outline" onClick={() => document.getElementById(uploadInputId)?.click()}>
            <Upload size={14} />
          </Button>
        </div>

        {value && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
            <img src={value} alt="Image preview" className="h-12 w-12 shrink-0 rounded object-cover" />
            <div className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
              {typeof value === 'string' && value.startsWith('data:')
                ? t('common.uploaded_image')
                : t('common.image_url')}
            </div>
            <Button
              type="button"
              size="icon-sm"
              variant="destructive"
              onClick={() => onChange(propertyName, '')}
              title={t('common.remove_image')}>
              <X size={14} />
            </Button>
          </div>
        )}
      </div>
    )
  }

  if (type === 'string' && enumValues) {
    const currentValue = String(value || defaultValue || '')
    return (
      <Select value={currentValue} onValueChange={(nextValue) => onChange(propertyName, nextValue)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={description || propertyName} />
        </SelectTrigger>
        <SelectContent>
          {enumValues.map((enumValue: string) => (
            <SelectItem key={enumValue} value={enumValue}>
              {enumValue}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (type === 'string') {
    if (propertyName.toLowerCase().includes('prompt') && propertyName !== 'prompt') {
      return (
        <Textarea.Input
          value={value || defaultValue || ''}
          onValueChange={(nextValue) => onChange(propertyName, nextValue)}
          rows={3}
          placeholder={description}
        />
      )
    }

    return (
      <Input
        value={value || defaultValue || ''}
        onChange={(event) => onChange(propertyName, event.target.value)}
        placeholder={description}
      />
    )
  }

  if (type === 'integer' && propertyName === 'seed') {
    const generateRandomSeed = () => Math.floor(Math.random() * 1000000)

    return (
      <div className="flex items-center gap-2">
        <Input
          className="flex-1"
          type="number"
          value={value ?? defaultValue ?? ''}
          min={schemaProperty.minimum}
          max={schemaProperty.maximum}
          step={1}
          onChange={(event) => onChange(propertyName, Number(event.target.value))}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={() => onChange(propertyName, generateRandomSeed())}>
          <RotateCcw size={14} />
        </Button>
      </div>
    )
  }

  if (type === 'integer' || type === 'number') {
    const step = type === 'number' ? 0.1 : 1
    return (
      <Input
        type="number"
        value={value ?? defaultValue ?? ''}
        min={schemaProperty.minimum}
        max={schemaProperty.maximum}
        step={step}
        onChange={(event) => {
          const nextValue = event.target.value
          onChange(propertyName, nextValue === '' ? undefined : Number(nextValue))
        }}
      />
    )
  }

  if (type === 'boolean') {
    return (
      <Switch
        checked={value !== undefined ? value : defaultValue}
        onCheckedChange={(checked) => onChange(propertyName, checked)}
      />
    )
  }

  return null
}

export default function SchemaField({ item, painting, onChange }: PaintingFieldComponentProps) {
  return (
    <div className="flex flex-col gap-3">
      {item.schema &&
        Object.entries(item.schema).map(([propKey, property]: [string, any]) => {
          if (propKey === 'prompt') return null
          return (
            <div key={propKey} className="flex flex-col">
              <div className="mb-1.5 flex items-center">
                <span className="font-medium text-[13px] capitalize">
                  {item.schemaReader ? item.schemaReader(property, 'title') : property.title || propKey}
                </span>
              </div>
              <SchemaValueField
                schemaProperty={property}
                propertyName={propKey}
                value={painting[propKey]}
                onChange={(field, value) => onChange({ [field]: value })}
              />
            </div>
          )
        })}
    </div>
  )
}
