import { CloseOutlined, LinkOutlined, RedoOutlined, UploadOutlined } from '@ant-design/icons'
import { Switch } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { convertToBase64 } from '@renderer/utils'
import { Input, InputNumber, Select, Upload } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

interface DynamicFormRenderProps {
  schemaProperty: any
  propertyName: string
  value: any
  onChange: (field: string, value: any) => void
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
      onChange: (field: string, value: any) => void
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
    return (
      <div className="flex flex-col gap-3">
        <div className="flex">
          <Input
            className="rounded-r-none! border-r-0!"
            value={value || defaultValue || ''}
            onChange={(e) => onChange(propertyName, e.target.value)}
            placeholder={t('common.image_url_or_upload')}
            prefix={<LinkOutlined className="text-[#999]" />}
          />
          <Upload
            accept="image/*"
            showUploadList={false}
            beforeUpload={(file) => {
              void handleImageUpload(propertyName, file, onChange)
              return false
            }}>
            <Button title={t('common.upload_image')} className="h-8 rounded-l-none">
              <UploadOutlined />
            </Button>
          </Upload>
        </div>

        {value && (
          <div className="flex items-center gap-2 rounded-[6px] border border-border bg-(--color-fill-quaternary) p-2">
            <img
              src={value}
              alt={t('common.image_preview')}
              className="h-12 w-12 shrink-0 rounded border border-(--color-border-secondary) object-cover shadow-[0_1px_4px_rgba(0,0,0,0.1)]"
            />
            <div className="min-w-0 flex-1 overflow-hidden text-ellipsis text-foreground-secondary text-xs">
              {value.startsWith('data:') ? t('common.uploaded_image') : t('common.image_url')}
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onChange(propertyName, '')}
              title={t('common.remove_image')}
              className="min-w-0 shrink-0 px-2">
              <CloseOutlined />
            </Button>
          </div>
        )}
      </div>
    )
  }

  if (type === 'string' && enumValues) {
    return (
      <Select
        className="w-full"
        value={value || defaultValue}
        options={enumValues.map((val: string) => ({ label: val, value: val }))}
        onChange={(v) => onChange(propertyName, v)}
      />
    )
  }

  if (type === 'string') {
    if (propertyName.toLowerCase().includes('prompt') && propertyName !== 'prompt') {
      return (
        <TextArea
          value={value || defaultValue || ''}
          onChange={(e) => onChange(propertyName, e.target.value)}
          rows={3}
          placeholder={description}
        />
      )
    }
    return (
      <Input
        value={value || defaultValue || ''}
        onChange={(e) => onChange(propertyName, e.target.value)}
        placeholder={description}
      />
    )
  }

  if (type === 'integer' && propertyName === 'seed') {
    const generateRandomSeed = () => Math.floor(Math.random() * 1000000)
    return (
      <div className="flex items-center gap-2">
        <InputNumber
          className="flex-1"
          value={value || defaultValue}
          onChange={(v) => onChange(propertyName, v)}
          step={1}
          min={schemaProperty.minimum}
          max={schemaProperty.maximum}
        />
        <Button
          size="sm"
          onClick={() => onChange(propertyName, generateRandomSeed())}
          title={t('common.generate_random_seed')}>
          <RedoOutlined />
        </Button>
      </div>
    )
  }

  if (type === 'integer' || type === 'number') {
    const step = type === 'number' ? 0.1 : 1
    return (
      <InputNumber
        className="w-full"
        value={value || defaultValue}
        onChange={(v) => onChange(propertyName, v)}
        step={step}
        min={schemaProperty.minimum}
        max={schemaProperty.maximum}
      />
    )
  }

  if (type === 'boolean') {
    return (
      <Switch
        checked={value !== undefined ? value : defaultValue}
        onCheckedChange={(checked) => onChange(propertyName, checked)}
        className="w-0.5"
      />
    )
  }

  return null
}
