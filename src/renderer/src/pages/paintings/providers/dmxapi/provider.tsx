import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { uuid } from '@renderer/utils'

import { SettingHelpLink } from '../../../settings'
import type { DmxapiPaintingData as DmxapiPainting } from '../../model/types/paintingData'
import { generationModeType } from '../../model/types/paintingData'
import { createMultiModeProvider, type GenerateContext, type PaintingProviderDefinition } from '../types'
import { COURSE_URL, DEFAULT_PAINTING, GetModelGroup, MODEOPTIONS, TOP_UP_URL } from './config'
import { buildDmxapiConfigFields } from './fields'
import { generateWithDmxapi } from './generate'
import {
  clearDmxapiFileMap,
  getDmxapiModelGroups,
  getDmxapiModelOptionsForMode,
  getFirstDmxapiModelInfo,
  setDmxapiModelGroups,
  toDmxapiDbMode
} from './runtime'
import { DmxapiSidebarExtra } from './slots'

const generateRandomSeed = () => Math.floor(Math.random() * 1000000).toString()

export const dmxapiProvider: PaintingProviderDefinition<DmxapiPainting> = createMultiModeProvider<DmxapiPainting>({
  id: 'dmxapi',
  mode: {
    tabs: MODEOPTIONS.map((mode) => ({ value: mode.value, labelKey: mode.labelKey })),
    defaultTab: generationModeType.GENERATION,
    tabToDbMode: (tab: string) => toDmxapiDbMode(tab),
    getModels: (tab: string) => ({
      type: 'async' as const,
      loader: async () => {
        if (!getDmxapiModelGroups()) {
          const data = await GetModelGroup()
          setDmxapiModelGroups(data)
        }

        const groups = getDmxapiModelOptionsForMode(tab, getDmxapiModelGroups())
        const options: Array<{ label: string; value: string; group?: string; [key: string]: any }> = []

        for (const [providerName, models] of Object.entries(groups)) {
          for (const model of models) {
            options.push({
              label: model.name,
              value: model.id,
              group: providerName,
              price: model.price,
              image_sizes: model.image_sizes,
              is_custom_size: model.is_custom_size,
              min_image_size: model.min_image_size,
              max_image_size: model.max_image_size,
              extend_params: (model as any).extend_params
            })
          }
        }

        return options
      }
    }),
    createPaintingData: ({ tab, modelOptions }) => {
      const generationMode = (tab as generationModeType) || generationModeType.GENERATION
      clearDmxapiFileMap()

      if (modelOptions && modelOptions.length > 0) {
        const first = modelOptions[0]
        return {
          ...DEFAULT_PAINTING,
          id: uuid(),
          seed: generateRandomSeed(),
          generationMode,
          model: first.value,
          priceModel: first.price || '',
          image_size: first.image_sizes?.[0]?.value || '1328x1328',
          extend_params: first.extend_params || {}
        }
      }

      const { model, priceModel, image_size, extend_params } = getFirstDmxapiModelInfo(
        generationMode,
        getDmxapiModelGroups()
      )
      return {
        ...DEFAULT_PAINTING,
        id: uuid(),
        seed: generateRandomSeed(),
        generationMode,
        model,
        priceModel,
        image_size,
        extend_params
      }
    }
  },
  fields: {
    byTab: Object.fromEntries(MODEOPTIONS.map((mode) => [mode.value, buildDmxapiConfigFields()])),
    onModelChange: ({ modelId, modelOptions }) => {
      const model = modelOptions.find((item) => item.value === modelId)
      if (model) {
        return {
          model: modelId,
          priceModel: model.price,
          image_size: model.image_sizes?.[0]?.value || '',
          extend_params: model.extend_params || {}
        } as Partial<DmxapiPainting>
      }
      return { model: modelId } as Partial<DmxapiPainting>
    }
  },
  slots: {
    headerExtra: (_provider, t) => {
      const Icon = resolveProviderIcon('dmxapi')
      return (
        <>
          <SettingHelpLink target="_blank" href={COURSE_URL}>
            {t('paintings.paint_course')}
          </SettingHelpLink>
          <SettingHelpLink target="_blank" href={TOP_UP_URL}>
            {t('paintings.top_up')}
          </SettingHelpLink>
          {Icon ? <Icon.Avatar size={16} className="ml-1" /> : null}
        </>
      )
    },
    sidebarExtra: (state) => {
      const isEditOrMerge = state.tab === generationModeType.EDIT || state.tab === generationModeType.MERGE
      return <DmxapiSidebarExtra mode={state.tab} isEditOrMerge={isEditOrMerge} t={state.t} />
    }
  },
  generate: (ctx: GenerateContext<DmxapiPainting>) => generateWithDmxapi(ctx)
})
