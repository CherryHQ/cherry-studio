import { useQuery } from '@data/hooks/useDataApi'
import { getBuiltinOcrProviderLabel } from '@renderer/i18n/label'
import type { ListOcrProvidersQuery, OcrProvider } from '@renderer/types'
import { isBuiltinOcrProvider } from '@renderer/types'

export const useOcrProviders = (query?: ListOcrProvidersQuery) => {
  const { data, loading, error } = useQuery('/ocr/providers', { query })

  const getOcrProviderName = (p: OcrProvider) => {
    return isBuiltinOcrProvider(p) ? getBuiltinOcrProviderLabel(p.id) : p.name
  }

  return {
    providers: data?.data,
    loading,
    error,
    getOcrProviderName
  }
}
