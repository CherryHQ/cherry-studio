import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { uuid } from '@renderer/utils'

import { SettingHelpLink } from '../../../settings'
import type { TokenFluxPaintingData as TokenFluxPainting } from '../../model/types/paintingData'
import { createSingleModeProvider, type GenerateContext, type PaintingProviderDefinition } from '../types'
import { DEFAULT_TOKENFLUX_PAINTING } from './config'
import { tokenFluxFields } from './fields'
import { generateWithTokenFlux } from './generate'
import { TokenFluxCenterContent, TokenFluxSidebarWrapper } from './slots'

export const tokenFluxProvider: PaintingProviderDefinition<TokenFluxPainting> =
  createSingleModeProvider<TokenFluxPainting>({
    id: 'tokenflux',
    dbMode: 'generate',
    models: {
      type: 'dynamic',
      resolver: () => []
    },
    createPaintingData: () => ({
      ...DEFAULT_TOKENFLUX_PAINTING,
      id: uuid()
    }),
    fields: tokenFluxFields,
    onModelChange: ({ modelId }) => ({ model: modelId, inputParams: {} }),
    prompt: {
      translateShortcut: true
    },
    slots: {
      headerExtra: (_provider, t) => {
        const Icon = resolveProviderIcon('tokenflux')
        return (
          <SettingHelpLink target="_blank" href="https://tokenflux.ai">
            {t('paintings.learn_more')}
            {Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null}
          </SettingHelpLink>
        )
      },
      sidebarExtra: (state) => <TokenFluxSidebarWrapper state={state} />,
      centerContent: (state) => <TokenFluxCenterContent state={state} />
    },
    generate: (ctx: GenerateContext<TokenFluxPainting>) => generateWithTokenFlux(ctx)
  })
