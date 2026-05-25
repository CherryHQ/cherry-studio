import type { Model } from '@shared/data/types/model'

import type { OpenApiCompatiblePaintingData, PaintingData, TokenFluxPaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'
import { DmxapiSetting } from '../providers/dmxapi'
import { NewApiSetting } from '../providers/newapi'
import { TokenFluxCenterContent, TokenFluxSetting } from '../providers/tokenflux'
import Artboard from './Artboard'

const NON_OPENAPI_PROVIDER_IDS = new Set(['aihubmix', 'dmxapi', 'ovms', 'ppio', 'silicon', 'tokenflux', 'zhipu'])

function isTokenFluxPainting(painting: PaintingData): painting is TokenFluxPaintingData {
  return painting.providerId === 'tokenflux'
}

function isRegistryModel(value: unknown): value is Model {
  return Boolean(
    value && typeof value === 'object' && 'id' in value && 'providerId' in value && 'capabilities' in value
  )
}

function isOpenApiCompatiblePainting(painting: PaintingData): painting is OpenApiCompatiblePaintingData {
  return !NON_OPENAPI_PROVIDER_IDS.has(painting.providerId)
}

export function PaintingSettingsExtras({
  provider,
  painting,
  modelOptions,
  selectedModelOption,
  patchPainting,
  tab
}: {
  provider: PaintingProviderRuntime
  painting: PaintingData
  modelOptions: ModelOption[]
  selectedModelOption?: ModelOption
  isLoading: boolean
  patchPainting: (updates: Partial<PaintingData>) => void
  tab: string
}) {
  if (provider.id === 'dmxapi') {
    return <DmxapiSetting paintingId={painting.id} mode={tab} />
  }

  if (provider.id === 'tokenflux') {
    if (!isTokenFluxPainting(painting)) {
      return null
    }

    return (
      <TokenFluxSetting
        painting={painting}
        patchPainting={(updates) => patchPainting(updates as Partial<PaintingData>)}
        selectedModel={isRegistryModel(selectedModelOption?.raw) ? selectedModelOption.raw : undefined}
      />
    )
  }

  if (
    provider.id === 'new-api' ||
    provider.presetProviderId === 'new-api' ||
    ['cherryin', 'aionly'].includes(provider.id)
  ) {
    if (!isOpenApiCompatiblePainting(painting)) {
      return null
    }

    return (
      <NewApiSetting
        providerId={provider.id}
        painting={painting}
        modelOptions={modelOptions}
        patchPainting={(updates) => patchPainting(updates as Partial<PaintingData>)}
        tab={tab}
      />
    )
  }

  return null
}

export function PaintingArtboard({
  painting,
  isLoading,
  onCancel
}: {
  painting: PaintingData
  isLoading: boolean
  onCancel: () => void
}) {
  if (isTokenFluxPainting(painting)) {
    return <TokenFluxCenterContent painting={painting} isLoading={isLoading} onCancel={onCancel} />
  }

  return <Artboard painting={painting} isLoading={isLoading} onCancel={onCancel} />
}
