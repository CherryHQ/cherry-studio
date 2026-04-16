import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { AiProvider } from '@renderer/aiCore'
import FileManager from '@renderer/services/FileManager'
import { uuid } from '@renderer/utils'

import { SettingHelpLink } from '../../settings'
import {
  COURSE_URL,
  DEFAULT_PAINTING,
  IMAGE_SIZES,
  QUALITY_OPTIONS,
  TOP_UP_URL,
  ZHIPU_PAINTING_MODELS
} from '../config/ZhipuConfig'
import { checkProviderEnabled } from '../utils'
import { runGeneration } from '../utils/runGeneration'
import type { GenerateContext, PaintingProviderDefinition } from './types'

export const zhipuProvider: PaintingProviderDefinition = {
  providerId: 'zhipu',

  models: {
    type: 'static',
    options: ZHIPU_PAINTING_MODELS.map((m) => ({ label: m.name, value: m.id }))
  },

  configFields: [
    {
      type: 'radio',
      key: 'quality',
      title: 'paintings.quality',
      options: QUALITY_OPTIONS.map((o) => ({ labelKey: o.label, value: o.value })),
      initialValue: 'standard',
      condition: (painting) => painting.model === 'cogview-4-250304'
    },
    {
      type: 'select',
      key: 'imageSize',
      title: 'paintings.image.size',
      options: [
        ...IMAGE_SIZES.map((s) => ({ labelKey: s.label, value: s.value })),
        { labelKey: 'paintings.custom_size', value: 'custom' }
      ],
      initialValue: '1024x1024'
    },
    {
      type: 'customSize',
      key: 'customSize',
      widthKey: 'customWidth',
      heightKey: 'customHeight',
      sizeKey: 'imageSize',
      validation: {
        minWidth: 512,
        maxWidth: 2048,
        minHeight: 512,
        maxHeight: 2048,
        divisibleBy: 16,
        maxPixels: 2097152
      },
      condition: (painting) => painting.imageSize === 'custom'
    }
  ] as any[],

  getDefaultPainting: () => ({
    ...DEFAULT_PAINTING,
    id: uuid()
  }),

  onModelChange: (modelId) => ({ model: modelId }),

  showTranslate: false,

  providerHeaderExtra: (provider, t) => {
    const Icon = resolveProviderIcon(provider.id)
    return (
      <>
        <SettingHelpLink target="_blank" href={TOP_UP_URL}>
          {t('paintings.top_up')}
        </SettingHelpLink>
        <SettingHelpLink target="_blank" href={COURSE_URL}>
          {t('paintings.paint_course')}
        </SettingHelpLink>
        {Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null}
      </>
    )
  },

  async onGenerate(ctx: GenerateContext) {
    const { painting: rawPainting, provider, abortController, t } = ctx
    const painting = rawPainting as any

    await checkProviderEnabled(provider, t)

    if (!painting.prompt?.trim()) {
      window.modal.error({
        content: t('paintings.prompt_required'),
        centered: true
      })
      return
    }

    if (painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })
      if (!confirmed) return
      await FileManager.deleteFiles(painting.files)
    }

    await runGeneration(ctx, async () => {
      const aiProvider = new AiProvider(provider)

      let actualImageSize = painting.imageSize

      if (painting.imageSize === 'custom') {
        const customWidth = painting.customWidth as number | undefined
        const customHeight = painting.customHeight as number | undefined

        if (!customWidth || !customHeight) {
          window.modal.error({
            content: t('paintings.zhipu.custom_size_required'),
            centered: true
          })
          return
        }

        if (customWidth < 512 || customWidth > 2048 || customHeight < 512 || customHeight > 2048) {
          window.modal.error({
            content: t('paintings.zhipu.custom_size_range'),
            centered: true
          })
          return
        }

        if (customWidth % 16 !== 0 || customHeight % 16 !== 0) {
          window.modal.error({
            content: t('paintings.zhipu.custom_size_divisible'),
            centered: true
          })
          return
        }

        if (customWidth * customHeight > 2097152) {
          window.modal.error({
            content: t('paintings.zhipu.custom_size_pixels'),
            centered: true
          })
          return
        }

        actualImageSize = `${customWidth}x${customHeight}`
      }

      const images = await aiProvider.generateImage({
        model: painting.model,
        prompt: painting.prompt,
        negativePrompt: painting.negativePrompt,
        imageSize: actualImageSize,
        batchSize: painting.numImages,
        quality: painting.quality,
        signal: abortController.signal
      })

      if (images.length > 0) {
        return { base64s: images }
      }
    })
  }
}
