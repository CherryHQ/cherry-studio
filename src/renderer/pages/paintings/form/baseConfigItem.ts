/**
 * Form field descriptor types produced by `imageGenerationToFields` and
 * consumed by `PaintingFieldRenderer`. `type` is the discriminant: every
 * renderer receives only the constraints and initial value shape it supports.
 */

type PaintingParams = Record<string, unknown>

export type OptionItem = {
  label?: string
  labelKey?: string
  title?: string
  value?: string | number
  icon?: string
  options?: OptionItem[]
}

export type SizeValidation = {
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  divisibleBy?: number
  maxPixels?: number
}

type CommonConfigItem = {
  key: string
  title?: string
  tooltip?: string
  disabled?: boolean | ((config: BaseConfigItem, painting: PaintingParams) => boolean)
  condition?: (painting: PaintingParams) => boolean
}

type NonSliderConstraints = {
  min?: never
  max?: never
  step?: never
}

type OptionSource = OptionItem[] | ((config: BaseConfigItem, painting: PaintingParams) => OptionItem[])

export type SelectConfigItem = CommonConfigItem &
  NonSliderConstraints & {
    type: 'select'
    options: OptionSource
    initialValue?: string
  }

export type RadioConfigItem = CommonConfigItem &
  NonSliderConstraints & {
    type: 'radio'
    options: OptionSource
    initialValue?: string | number
  }

export type SliderConfigItem = CommonConfigItem & {
  type: 'slider'
  min: number
  max: number
  step?: number
  initialValue: number
  options?: never
}

export type InputConfigItem = CommonConfigItem &
  NonSliderConstraints & {
    type: 'input'
    initialValue?: string
    options?: never
  }

export type SwitchConfigItem = CommonConfigItem &
  NonSliderConstraints & {
    type: 'switch'
    initialValue: boolean
    options?: never
  }

export type TextareaConfigItem = CommonConfigItem &
  NonSliderConstraints & {
    type: 'textarea'
    initialValue?: string
    options?: never
  }

export type ImageConfigItem = CommonConfigItem &
  NonSliderConstraints & {
    type: 'image'
    initialValue?: string
    options?: never
  }

export type CustomSizeConfigItem = CommonConfigItem &
  NonSliderConstraints & {
    type: 'customSize'
    widthKey: string
    heightKey: string
    sizeKey: string
    validation: SizeValidation
    initialValue?: never
    options?: never
  }

export type IconRadioConfigItem = CommonConfigItem &
  NonSliderConstraints & {
    type: 'iconRadio'
    options: OptionSource
    columns?: number
    initialValue?: string | number
  }

export type StyleToggleConfigItem = CommonConfigItem &
  NonSliderConstraints & {
    type: 'styleToggle'
    options: OptionSource
    toggleMode?: 'single' | 'multi'
    initialValue?: string
  }

export type SizeChipsConfigItem = CommonConfigItem &
  NonSliderConstraints & {
    type: 'sizeChips'
    options: OptionSource
    columns?: number
    initialValue?: string
  }

export type OptionsConfigItem =
  | SelectConfigItem
  | RadioConfigItem
  | IconRadioConfigItem
  | StyleToggleConfigItem
  | SizeChipsConfigItem

export type BaseConfigItem =
  | OptionsConfigItem
  | SliderConfigItem
  | InputConfigItem
  | SwitchConfigItem
  | TextareaConfigItem
  | ImageConfigItem
  | CustomSizeConfigItem

export function isOptionsConfigItem(item: BaseConfigItem): item is OptionsConfigItem {
  return ['select', 'radio', 'iconRadio', 'styleToggle', 'sizeChips'].includes(item.type)
}
