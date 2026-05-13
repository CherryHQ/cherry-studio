type PrimitiveValue = string | number | boolean | undefined

export type OptionItem = {
  label?: string
  labelKey?: string
  title?: string
  value?: string | number
  icon?: string
  options?: OptionItem[]
}

export type BaseConfigItem = {
  type:
    | 'select'
    | 'radio'
    | 'slider'
    | 'input'
    | 'switch'
    | 'inputNumber'
    | 'textarea'
    | 'image'
    | 'customSize'
    | 'iconRadio'
    | 'styleToggle'
    | 'dynamicSchema'
    | 'sizeChips'
  key?: string
  title?: string
  tooltip?: string
  options?: OptionItem[] | ((config: BaseConfigItem, painting: Record<string, unknown>) => OptionItem[])
  min?: number
  max?: number
  step?: number
  initialValue?: PrimitiveValue
  disabled?: boolean | ((config: BaseConfigItem, painting: Record<string, unknown>) => boolean)
  condition?: (painting: Record<string, unknown>) => boolean
  widthKey?: string
  heightKey?: string
  sizeKey?: string
  validation?: {
    minWidth?: number
    maxWidth?: number
    minHeight?: number
    maxHeight?: number
    divisibleBy?: number
    maxPixels?: number
  }
  columns?: number
  toggleMode?: 'single' | 'multi'
  schema?: Record<string, any>
  schemaReader?: (property: Record<string, any>, key: string) => string
}
