import { AiProvider } from '@renderer/aiCore'
import ImageSize1_1 from '@renderer/assets/images/paintings/image-size-1-1.svg'
import ImageSize1_2 from '@renderer/assets/images/paintings/image-size-1-2.svg'
import ImageSize3_2 from '@renderer/assets/images/paintings/image-size-3-2.svg'
import ImageSize3_4 from '@renderer/assets/images/paintings/image-size-3-4.svg'
import ImageSize9_16 from '@renderer/assets/images/paintings/image-size-9-16.svg'
import ImageSize16_9 from '@renderer/assets/images/paintings/image-size-16-9.svg'
import { getProviderByModel } from '@renderer/services/AssistantService'
import FileManager from '@renderer/services/FileManager'
import type { PaintingCanvas } from '@renderer/types'
import { uuid } from '@renderer/utils'

import { checkProviderEnabled } from '../utils'
import { runGeneration } from '../utils/runGeneration'
import type { GenerateContext, PaintingProviderDefinition } from './types'

export const TEXT_TO_IMAGES_MODELS = [
  {
    id: 'Kwai-Kolors/Kolors',
    provider: 'silicon',
    name: 'Kolors',
    group: 'Kwai-Kolors'
  },
  {
    id: 'Qwen/Qwen-Image',
    provider: 'silicon',
    name: 'Qwen-Image',
    group: 'qwen'
  }
]

const IMAGE_SIZES = [
  { label: '1:1', value: '1024x1024', icon: ImageSize1_1 },
  { label: '1:2', value: '512x1024', icon: ImageSize1_2 },
  { label: '3:2', value: '768x512', icon: ImageSize3_2 },
  { label: '3:4', value: '768x1024', icon: ImageSize3_4 },
  { label: '16:9', value: '1024x576', icon: ImageSize16_9 },
  { label: '9:16', value: '576x1024', icon: ImageSize9_16 }
]

const generateRandomSeed = () => Math.floor(Math.random() * 1000000).toString()

export const siliconProvider: PaintingProviderDefinition = {
  providerId: 'silicon',

  models: {
    type: 'static',
    options: TEXT_TO_IMAGES_MODELS.map((m) => ({ label: m.name, value: m.id }))
  },

  configFields: [
    {
      type: 'iconRadio',
      key: 'imageSize',
      title: 'paintings.image.size',
      columns: 3,
      options: IMAGE_SIZES.map((s) => ({ label: s.label, value: s.value, icon: s.icon })),
      initialValue: '1024x1024'
    },
    {
      type: 'iconRadio',
      key: 'numImages',
      title: 'paintings.number_images',
      tooltip: 'paintings.number_images_tip',
      columns: 4,
      options: [
        { label: '1', value: '1' },
        { label: '2', value: '2' },
        { label: '3', value: '3' },
        { label: '4', value: '4' }
      ],
      initialValue: '1'
    },
    {
      type: 'input',
      key: 'seed',
      title: 'paintings.seed',
      tooltip: 'paintings.seed_tip',
      initialValue: ''
    },
    {
      type: 'slider',
      key: 'steps',
      title: 'paintings.inference_steps',
      tooltip: 'paintings.inference_steps_tip',
      min: 1,
      max: 50,
      initialValue: 25
    },
    {
      type: 'slider',
      key: 'guidanceScale',
      title: 'paintings.guidance_scale',
      tooltip: 'paintings.guidance_scale_tip',
      min: 1,
      max: 20,
      step: 0.1,
      initialValue: 4.5
    },
    {
      type: 'textarea',
      key: 'negativePrompt',
      title: 'paintings.negative_prompt',
      tooltip: 'paintings.negative_prompt_tip'
    },
    {
      type: 'switch',
      key: 'promptEnhancement',
      title: 'paintings.prompt_enhancement',
      tooltip: 'paintings.prompt_enhancement_tip',
      initialValue: false
    }
  ] as any[],

  getDefaultPainting: () => ({
    id: uuid(),
    files: [],
    prompt: '',
    negativePrompt: '',
    imageSize: '1024x1024',
    numImages: 1,
    seed: generateRandomSeed(),
    steps: 25,
    guidanceScale: 4.5,
    model: TEXT_TO_IMAGES_MODELS[0].id
  }),

  onModelChange: (modelId) => ({ model: modelId }),

  showTranslate: true,

  async onGenerate(ctx: GenerateContext) {
    const { painting: rawPainting, provider, abortController, patchPainting, t } = ctx
    const painting = rawPainting as any

    await checkProviderEnabled(provider, t)

    if (painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })
      if (!confirmed) return
      await FileManager.deleteFiles(painting.files)
    }

    const prompt = painting.prompt || ''
    patchPainting({ prompt } as Partial<PaintingCanvas>)

    const model = TEXT_TO_IMAGES_MODELS.find((m) => m.id === painting.model)
    const resolvedProvider = getProviderByModel(model)

    if (!resolvedProvider.apiKey) {
      window.modal.error({
        content: t('error.no_api_key'),
        centered: true
      })
      return
    }

    if (!painting.model) return

    await runGeneration(ctx, async () => {
      const AI = new AiProvider(resolvedProvider)
      const numImages = Number(painting.numImages) || 1

      const urls = await AI.generateImage({
        model: painting.model,
        prompt,
        negativePrompt: painting.negativePrompt || '',
        imageSize: painting.imageSize || '1024x1024',
        batchSize: numImages,
        seed: painting.seed || undefined,
        numInferenceSteps: painting.steps || 25,
        guidanceScale: painting.guidanceScale || 4.5,
        signal: abortController.signal,
        promptEnhancement: painting.promptEnhancement || false
      })

      if (urls.length > 0) {
        return { urls }
      }
    })
  }
}
