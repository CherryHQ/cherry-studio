import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { uuid } from '@renderer/utils'
import type { TFunction } from 'i18next'

import { SettingHelpLink } from '../../../settings'
import type { TokenFluxPaintingData as TokenFluxPainting } from '../../model/types/paintingData'
import { createSingleModeProvider, type PaintingProviderDefinition } from '../types'
import { DEFAULT_TOKENFLUX_PAINTING } from './config'
import { tokenFluxFields } from './fields'
import { generateWithTokenFlux } from './generate'
import TokenFluxService from './service'

export function TokenFluxHeaderActions({ t }: { t: TFunction }) {
  const Icon = resolveProviderIcon('tokenflux')
  return (
    <SettingHelpLink target="_blank" href="https://tokenflux.ai">
      {t('paintings.learn_more')}
      {Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null}
    </SettingHelpLink>
  )
}

export const tokenFluxProvider: PaintingProviderDefinition = createSingleModeProvider<TokenFluxPainting>({
  id: 'tokenflux',
  dbMode: 'generate',
  models: {
    type: 'async',
    loader: async (provider) => {
      const service = new TokenFluxService(provider?.apiHost ?? '', (await provider?.getApiKey()) ?? '')
      const models = await service.fetchModels()

      return models.map((model) => ({
        label: model.name,
        value: model.id,
        group: model.model_provider,
        raw: model
      }))
    }
  },
  createPaintingData: () => ({
    ...DEFAULT_TOKENFLUX_PAINTING,
    id: uuid()
  }),
  fields: tokenFluxFields,
  onModelChange: ({ modelId }) => ({ model: modelId, inputParams: {} }),
  generate: (input) => generateWithTokenFlux(input)
})

export { TokenFluxCenterContent, TokenFluxSetting } from './components'
