import type { ComponentType } from 'react'

import type { BaseConfigItem } from '../form/baseConfigItem'
import SelectField from './fields/SelectField'
import SizeChipsField from './fields/SizeChipsField'
import SizeField from './fields/SizeField'

export interface PaintingFieldComponentProps {
  item: BaseConfigItem
  fieldKey: string
  painting: Record<string, unknown>
  translate: (key: string) => string
  onChange: (updates: Record<string, unknown>) => void
  onGenerateRandomSeed?: (key: string) => void
  currentValue: unknown
  disabled?: boolean
}

export type PaintingFieldComponent = ComponentType<PaintingFieldComponentProps>

export const fieldRegistry: Partial<Record<BaseConfigItem['type'], PaintingFieldComponent>> = {
  select: SelectField,
  sizeChips: SizeChipsField,
  customSize: SizeField
}
