import { CloseOutlined, RedoOutlined } from '@ant-design/icons'
import { convertToBase64 } from '@renderer/utils'
import { Button, Input, InputNumber, Select, Switch } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { useCallback } from 'react'

interface DynamicFormRenderProps {
  schemaProperty: any
  propertyName: string
  value: any
  onChange: (field: string, value: any) => void
}

export const DynamicFormRender: React.FC<DynamicFormRenderProps> = ({
  schemaProperty,
  propertyName,
  value,
  onChange
}) => {
  const { type, enum: enumValues, description, default: defaultValue, format } = schemaProperty

  const handleImageUpload = useCallback(
    async (propertyName: string, file: File, onChange: (field: string, value: any) => void): Promise<void> => {
      if (file) {
        try {
          const base64Image = await convertToBase64(file)
          if (typeof base64Image === 'string') {
            onChange(propertyName, base64Image)
          } else {
            console.error('Failed to convert image to base64')
            // Optionally, display an error message to the user
          }
        } catch (error) {
          console.error('Error converting image to base64:', error)
          // Optionally, display an error message to the user
        }
      }
    },
    []
  )

  if (type === 'string' && propertyName.toLowerCase().includes('image') && format === 'uri') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Input
          type="file"
          accept="image/*"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              handleImageUpload(propertyName, e.target.files[0], onChange)
            }
          }}
          placeholder={description || 'Select an image'}
        />
        {value && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img
              src={value}
              alt="Uploaded"
              style={{
                width: '60px',
                height: '60px',
                objectFit: 'cover',
                borderRadius: '4px',
                border: '1px solid var(--color-border)'
              }}
            />
            <Button
              size="small"
              danger
              icon={<CloseOutlined />}
              onClick={() => onChange(propertyName, null)}
              title="Remove image">
              Remove
            </Button>
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
