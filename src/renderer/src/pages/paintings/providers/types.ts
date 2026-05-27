export type PaintingGenerationResult = {
  urls: string[]
  base64s: string[]
}

export type DynamicFormValue = string | number | boolean | null | undefined

export interface DynamicFormSchemaProperty {
  type: string
  enum?: string[]
  description?: string
  default?: DynamicFormValue
  format?: string
  minimum?: number
  maximum?: number
  [key: string]: DynamicFormValue | string[] | undefined
}
