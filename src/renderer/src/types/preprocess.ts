export interface PreprocessProvider {
  id: PreprocessProviderId
  name: string
  apiKey?: string
  apiHost?: string
  model?: string
  options?: any
  quota?: number
}
export const PreprocessProviderIds = {
  doc2x: 'doc2x',
  mistral: 'mistral',
  mineru: 'mineru'
} as const
export type PreprocessProviderId = keyof typeof PreprocessProviderIds
export const isPreprocessProviderId = (id: string): id is PreprocessProviderId => {
  return Object.hasOwn(PreprocessProviderIds, id)
}
