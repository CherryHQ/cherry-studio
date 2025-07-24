import { CloseOutlined, LinkOutlined, RedoOutlined, UploadOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { convertToBase64 } from '@renderer/utils'
import { Button, Input, InputNumber, Select, Switch, Upload } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { useCallback } from 'react'

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
            window.message?.error('Invalid image URL format')
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
    []
  )

  if (type === 'string' && propertyName.toLowerCase().includes('image') && format === 'uri') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '0' }}>
          <Input
            style={{
              borderTopRightRadius: 0,
              borderBottomRightRadius: 0,
              borderRight: 'none'
            }}
            value={value || defaultValue || ''}
            onChange={(e) => onChange(propertyName, e.target.value)}
            placeholder="Enter image URL or upload file"
            prefix={<LinkOutlined style={{ color: '#999' }} />}
          />
          <Upload
            accept="image/*"
            showUploadList={false}
            beforeUpload={(file) => {
              handleImageUpload(propertyName, file, onChange)
              return false
            }}>
            <Button
              icon={<UploadOutlined />}
              title="Upload image file"
              style={{
                borderTopLeftRadius: 0,
                borderBottomLeftRadius: 0,
                height: '32px'
              }}
            />
          </Upload>
        </div>

        {value && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px',
              backgroundColor: 'var(--color-fill-quaternary)',
              borderRadius: '6px',
              border: '1px solid var(--color-border)'
            }}>
            <img
              src={value}
              alt="Image preview"
              style={{
                width: '48px',
                height: '48px',
                objectFit: 'cover',
                borderRadius: '4px',
                border: '1px solid var(--color-border-secondary)',
                boxShadow: '0 1px 4px rgba(0, 0, 0, 0.1)',
                flexShrink: 0
              }}
            />
            <div
              style={{
                flex: 1,
                fontSize: '12px',
                color: 'var(--color-text-secondary)',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
              {value.startsWith('data:') ? 'Uploaded image' : 'Image URL'}
            </div>
            <Button
              size="small"
              danger
              icon={<CloseOutlined />}
              onClick={() => onChange(propertyName, '')}
              title="Remove image"
              style={{ flexShrink: 0, minWidth: 'auto', padding: '0 8px' }}
            />
          </div>
        )}
      </div>
    )
  }

  if (type === 'string' && enumValues) {
    return (
      <Select
        style={{ width: '100%' }}
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
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <InputNumber
          style={{ flex: 1 }}
          value={value || defaultValue}
          onChange={(v) => onChange(propertyName, v)}
          step={1}
          min={schemaProperty.minimum}
          max={schemaProperty.maximum}
        />
        <Button
          size="small"
          icon={<RedoOutlined />}
          onClick={() => onChange(propertyName, generateRandomSeed())}
          title="Generate random seed"
        />
      </div>
    )
  }

  if (type === 'integer' || type === 'number') {
    const step = type === 'number' ? 0.1 : 1
    return (
      <InputNumber
        style={{ width: '100%' }}
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
        onChange={(checked) => onChange(propertyName, checked)}
        style={{ width: '2px' }}
      />
    )
  }

  return null
}
