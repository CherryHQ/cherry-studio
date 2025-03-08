import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addSubscribeSource as _addSubscribeSource,
  removeSubscribeSource as _removeSubscribeSource,
  setDefaultProvider as _setDefaultProvider,
  setSubscribeSources as _setSubscribeSources,
  updateSubscribeBlacklist as _updateSubscribeBlacklist,
  updateWebSearchProvider,
  updateWebSearchProviders
} from '@renderer/store/websearch'
import { WebSearchProvider } from '@renderer/types'

export const useDefaultWebSearchProvider = () => {
  const defaultProvider = useAppSelector((state) => state.websearch.defaultProvider)
  const { providers } = useWebSearchProviders()
  const provider = defaultProvider ? providers.find((provider) => provider.id === defaultProvider) : undefined
  const dispatch = useAppDispatch()

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
  const dispatch = useAppDispatch()

  return {
    providers,
    updateWebSearchProviders: (providers: WebSearchProvider[]) => dispatch(updateWebSearchProviders(providers))
  }
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

export const useBlacklist = () => {
  const dispatch = useAppDispatch()
  const websearch = useAppSelector((state) => state.websearch)

  const addSubscribeSource = ({ url, name, blacklist }) => {
    dispatch(_addSubscribeSource({ url, name, blacklist }))
  }

  const removeSubscribeSource = (key: number) => {
    dispatch(_removeSubscribeSource(key))
  }

  const updateSubscribeBlacklist = (key: number, blacklist: string[]) => {
    dispatch(_updateSubscribeBlacklist({ key, blacklist }))
  }

  const setSubscribeSources = (sources: { key: number; url: string; name: string; blacklist?: string[] }[]) => {
    dispatch(_setSubscribeSources(sources))
  }

  return {
    websearch,
    addSubscribeSource,
    removeSubscribeSource,
    updateSubscribeBlacklist,
    setSubscribeSources
  }
}
