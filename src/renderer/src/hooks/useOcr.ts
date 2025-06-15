import { RootState } from '@renderer/store'
import {
  setDefaultOcrProvider as _setDefaultOcrProvider,
  updateOcrProvider as _updateOcrProvider,
  updateOcrProviders as _updateOcrProviders
} from '@renderer/store/ocr'
import { OcrProvider } from '@renderer/types'
import { useDispatch, useSelector } from 'react-redux'

export const useOcrProvider = (id: string) => {
  const dispatch = useDispatch()
  const ocrProviders = useSelector((state: RootState) => state.ocr.providers)
  const provider = ocrProviders.find((provider) => provider.id === id)
  if (!provider) {
    throw new Error(`OCR provider with id ${id} not found`)
  }
  const updateOcrProvider = (ocrProvider: OcrProvider) => {
    dispatch(_updateOcrProvider(ocrProvider))
  }
  return { provider, updateOcrProvider }
}

export const useOcrProviders = () => {
  const dispatch = useDispatch()
  const ocrProviders = useSelector((state: RootState) => state.ocr.providers)
  return {
    ocrProviders: ocrProviders,
    updateOcrProviders: (ocrProviders: OcrProvider[]) => dispatch(_updateOcrProviders(ocrProviders))
  }
}

export const useDefaultOcrProvider = () => {
  const defaultProviderId = useSelector((state: RootState) => state.ocr.defaultProvider)
  const { ocrProviders } = useOcrProviders()
  const dispatch = useDispatch()
  const provider = defaultProviderId ? ocrProviders.find((provider) => provider.id === defaultProviderId) : undefined

  const setDefaultOcrProvider = (ocrProvider: OcrProvider) => {
    dispatch(_setDefaultOcrProvider(ocrProvider.id))
  }
  const updateDefaultOcrProvider = (ocrProvider: OcrProvider) => {
    dispatch(_updateOcrProvider(ocrProvider))
  }
  return { provider, setDefaultOcrProvider, updateDefaultOcrProvider }
}
