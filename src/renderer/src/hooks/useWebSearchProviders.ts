import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setDefaultProvider as _setDefaultProvider, updateWebSearchProvider } from '@renderer/store/websearch'
import { WebSearchProvider } from '@renderer/types'

export const useDefaultWebSearchProvider = () => {
  const defaultProvider = useAppSelector((state) => state.websearch.defaultProvider)
  const providers = useWebSearchProviders()
  const provider = providers.find((provider) => provider.id === defaultProvider)
  const dispatch = useAppDispatch()

  if (!provider) {
    throw new Error(`Web search provider with id ${defaultProvider} not found`)
  }

  const setDefaultProvider = (provider: WebSearchProvider) => {
    dispatch(_setDefaultProvider(provider.id))
  }

  const updateDefaultProvider = (provider: WebSearchProvider) => {
    dispatch(updateWebSearchProvider(provider))
  }

  return { provider, setDefaultProvider, updateDefaultProvider }
}

export const useWebSearchProviders = () => {
  const providers = useAppSelector((state) => state.websearch.providers)
  return providers
}

export const useWebSearchProvider = (id: string) => {
  const providers = useAppSelector((state) => state.websearch.providers)
  const provider = providers.find((provider) => provider.id === id)
  const dispatch = useAppDispatch()

  if (!provider) {
    throw new Error(`Web search provider with id ${id} not found`)
  }

  const updateProvider = (provider: WebSearchProvider) => {
    dispatch(updateWebSearchProvider(provider))
  }

  return { provider, updateProvider }
}
