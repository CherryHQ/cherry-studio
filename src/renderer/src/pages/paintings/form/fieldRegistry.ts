import type { ComponentType, ReactNode } from 'react'

import type { BaseConfigItem } from '../providers/shared/providerFieldSchema'
import ImageField from './fields/ImageField'
import NumberField from './fields/NumberField'
import SchemaField from './fields/SchemaField'
import SelectField from './fields/SelectField'
import SizeField from './fields/SizeField'

export interface PaintingFieldComponentProps {
  item: BaseConfigItem
  fieldKey: string
  painting: Record<string, unknown>
  translate: (key: string) => string
  onChange: (updates: Record<string, unknown>) => void
  onGenerateRandomSeed?: (key: string) => void
  onImageUpload?: (key: string, file: File) => void
  imagePreviewSrc?: string
  imagePlaceholder?: ReactNode
  currentValue: unknown
  disabled?: boolean
}

export type PaintingFieldComponent = ComponentType<PaintingFieldComponentProps>

export const fieldRegistry: Partial<Record<BaseConfigItem['type'], PaintingFieldComponent>> = {
  select: SelectField,
  inputNumber: NumberField,
  image: ImageField,
  customSize: SizeField,
  dynamicSchema: SchemaField
}
