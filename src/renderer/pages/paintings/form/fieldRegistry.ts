import type { ComponentType } from 'react'

import type { BaseConfigItem } from '../form/baseConfigItem'
import type { PaintingParams } from '../model/types/paintingData'
import SelectField from './fields/SelectField'
import SizeChipsField from './fields/SizeChipsField'
import SizeField from './fields/SizeField'

export interface PaintingFieldComponentProps<TType extends BaseConfigItem['type'] = BaseConfigItem['type']> {
  item: Extract<BaseConfigItem, { type: TType }>
  fieldKey: string
  painting: PaintingParams
  translate: (key: string) => string
  onChange: (updates: PaintingParams) => void
  onGenerateRandomSeed?: (key: string) => void
  currentValue: unknown
  disabled?: boolean
}

export type PaintingFieldComponent<TType extends BaseConfigItem['type']> = ComponentType<
  PaintingFieldComponentProps<TType>
>

type RegisteredFieldRegistry = {
  select: PaintingFieldComponent<'select'>
  sizeChips: PaintingFieldComponent<'sizeChips'>
  customSize: PaintingFieldComponent<'customSize'>
}

export const fieldRegistry = {
  select: SelectField,
  sizeChips: SizeChipsField,
  customSize: SizeField
} satisfies RegisteredFieldRegistry
