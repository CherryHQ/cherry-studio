import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { uuid } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'
import type { TFunction } from 'i18next'

import { SettingHelpLink } from '../../../settings'
import type { DmxapiPaintingData as DmxapiPainting } from '../../model/types/paintingData'
import { generationModeType } from '../../model/types/paintingData'
import type { ModelOption } from '../../model/types/paintingModel'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import type { PaintingProvider } from '../types'
import { COURSE_URL, DEFAULT_PAINTING, MODEOPTIONS, TOP_UP_URL } from './config'
import { buildDmxapiConfigFields } from './fields'
import { generateWithDmxapiUnified } from './generateUnified'
import { clearDmxapiFileMap, type DmxapiModelMeta, setDmxapiModelMetaCache, toDmxapiDbMode } from './runtime'

const generateRandomSeed = () => Math.floor(Math.random() * 1000000).toString()

export function DmxapiHeaderActions({ t }: { t: TFunction }) {
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
}

/**
 * Map a painting-page tab value to the canonical `ImageGenerationMode`. dmxapi's
 * tabs already use the same string values ('generate' / 'edit' / 'merge'); kept
 * as a function for clarity at the filter call-site.
 */
const tabToImageMode = (tab: string): 'generate' | 'edit' | 'merge' => {
  if (tab === 'edit') return 'edit'
  if (tab === 'merge') return 'merge'
  return 'generate'
}

/**
 * Pull dmxapi-specific UI metadata off the registry's `imageGeneration` block
 * so the painting page can render its dropdown labels, default size, custom-size
 * gate, and pass `extend_params` through providerBag — without a side-channel
 * catalog fetch. Replaces the bundled `DMXApiModelData` shape (Phase B).
 */
function modelOptionFromRegistry(opt: ModelOption<Model>): ModelOption<Model> {
  const ig = opt.raw?.imageGeneration
  const sizes = ig?.sizes ?? []
  return {
    ...opt,
    meta: {
      ...opt.meta,
      price: '',
      image_sizes: sizes.map((v: string) => ({ label: v, value: v })),
      is_custom_size: ig?.customSize !== undefined,
      min_image_size: ig?.customSize?.min,
      max_image_size: ig?.customSize?.max,
      extend_params: ig?.vendorParams ?? {}
    }
  }
}

export const dmxapiProvider = {
  id: 'dmxapi',
  mode: {
    tabs: MODEOPTIONS.map((mode) => ({ value: mode.value, labelKey: mode.labelKey })),
    defaultTab: generationModeType.GENERATION,
    tabToDbMode: (tab: string) => toDmxapiDbMode(tab),
    // Dropdown = (user's enabled dmxapi image-gen models) ∩ (the canonical
    // `imageGeneration.modes` allowlist for the current tab). The registry's
    // `imageGeneration` block carries everything the painting page needs
    // (sizes, custom-size range, vendorParams = `extend_params`) — no
    // server fetch and no bundled catalog file.
    getModels: (tab: string) => ({
      type: 'async' as const,
      loader: async () => {
        const all = (await loadPaintingModelOptions('dmxapi')) as ModelOption<Model>[]
        // Seed the sync cache so the field renderer's options callback (which
        // is synchronous) can look up per-model size lists at render time.
        const metaForCache: DmxapiModelMeta[] = all.map((opt) => {
          const ig = opt.raw?.imageGeneration
          return {
            id: opt.value,
            image_sizes: (ig?.sizes ?? []).map((v: string) => ({ label: v, value: v })),
            is_custom_size: ig?.customSize !== undefined,
            min_image_size: ig?.customSize?.min,
            max_image_size: ig?.customSize?.max
          }
        })
        setDmxapiModelMetaCache(metaForCache)

        const requiredMode = tabToImageMode(tab)
        return all
          .filter((opt) => {
            const modes = opt.raw?.imageGeneration?.modes
            return modes ? modes.includes(requiredMode) : requiredMode === 'generate'
          })
          .map(modelOptionFromRegistry)
      }
    }),
    createPaintingData: ({ tab, modelOptions }) => {
      const generationMode = (tab as generationModeType) || generationModeType.GENERATION
      clearDmxapiFileMap()

      const first = modelOptions?.[0]
      const firstMeta = first?.meta ?? {}
      return {
        ...DEFAULT_PAINTING,
        id: uuid(),
        mode: toDmxapiDbMode(tab),
        seed: generateRandomSeed(),
        generationMode,
        model: first?.value || '',
        priceModel: String(firstMeta.price || ''),
        image_size:
          (firstMeta.image_sizes as Array<{ label: string; value: string }> | undefined)?.[0]?.value || '1328x1328',
        extend_params: (firstMeta.extend_params as Record<string, unknown> | undefined) || {}
      }
    }
  },
  fields: {
    byTab: Object.fromEntries(MODEOPTIONS.map((mode) => [mode.value, buildDmxapiConfigFields()])),
    onModelChange: ({ modelId, modelOptions }) => {
      const model = modelOptions.find((item) => item.value === modelId)
      if (model) {
        const modelMeta = model.meta ?? {}
        return {
          model: modelId,
          priceModel: String(modelMeta.price || ''),
          image_size: (modelMeta.image_sizes as Array<{ label: string; value: string }> | undefined)?.[0]?.value || '',
          extend_params: (modelMeta.extend_params as Record<string, unknown> | undefined) || {}
        } as Partial<DmxapiPainting>
      }
      return { model: modelId } as Partial<DmxapiPainting>
    }
  },
  generate: (input) => generateWithDmxapiUnified(input)
} satisfies PaintingProvider<DmxapiPainting>

export { DmxapiSetting } from './components'
