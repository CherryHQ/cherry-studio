import type { ImageGenerationSupport } from '../schemas/model'

export const IMAGE_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '4:5',
  '5:4',
  '2:1',
  '1:2',
  '21:9',
  '9:21',
  '3:1',
  '1:3',
  '1:4',
  '4:1',
  '1:8',
  '8:1',
  '19.5:9',
  '9:19.5',
  '20:9',
  '9:20',
  '5:2'
]
export const IMAGE_RESOLUTIONS = ['1K', '1.5K', '2K', '3K', '4K']

/** Curated valid request canvases, not measurements of a gateway's output. */
export const OPENAI_IMAGE_CANVASES = [
  { resolution: '1K', aspectRatio: '1:1', size: '1024x1024' },
  { resolution: '1K', aspectRatio: '3:2', size: '1536x1024' },
  { resolution: '1K', aspectRatio: '2:3', size: '1024x1536' },
  { resolution: '1K', aspectRatio: '16:9', size: '1536x864' },
  { resolution: '1K', aspectRatio: '9:16', size: '864x1536' },
  { resolution: '1K', aspectRatio: '4:3', size: '1024x768' },
  { resolution: '1K', aspectRatio: '3:4', size: '768x1024' },
  { resolution: '1K', aspectRatio: '4:5', size: '896x1120' },
  { resolution: '1K', aspectRatio: '5:4', size: '1120x896' },
  { resolution: '1K', aspectRatio: '2:1', size: '1536x768' },
  { resolution: '1K', aspectRatio: '1:2', size: '768x1536' },
  { resolution: '1K', aspectRatio: '21:9', size: '1792x768' },
  { resolution: '1K', aspectRatio: '9:21', size: '768x1792' },
  { resolution: '1K', aspectRatio: '3:1', size: '1536x512' },
  { resolution: '1K', aspectRatio: '1:3', size: '512x1536' },
  { resolution: '2K', aspectRatio: '1:1', size: '2048x2048' },
  { resolution: '2K', aspectRatio: '3:2', size: '2016x1344' },
  { resolution: '2K', aspectRatio: '2:3', size: '1344x2016' },
  { resolution: '2K', aspectRatio: '16:9', size: '2048x1152' },
  { resolution: '2K', aspectRatio: '9:16', size: '1152x2048' },
  { resolution: '2K', aspectRatio: '4:3', size: '2048x1536' },
  { resolution: '2K', aspectRatio: '3:4', size: '1536x2048' },
  { resolution: '2K', aspectRatio: '4:5', size: '1600x2000' },
  { resolution: '2K', aspectRatio: '5:4', size: '2000x1600' },
  { resolution: '2K', aspectRatio: '2:1', size: '2048x1024' },
  { resolution: '2K', aspectRatio: '1:2', size: '1024x2048' },
  { resolution: '2K', aspectRatio: '21:9', size: '2352x1008' },
  { resolution: '2K', aspectRatio: '9:21', size: '1008x2352' },
  { resolution: '2K', aspectRatio: '3:1', size: '2016x672' },
  { resolution: '2K', aspectRatio: '1:3', size: '672x2016' },
  { resolution: '4K', aspectRatio: '1:1', size: '2880x2880' },
  { resolution: '4K', aspectRatio: '3:2', size: '3504x2336' },
  { resolution: '4K', aspectRatio: '2:3', size: '2336x3504' },
  { resolution: '4K', aspectRatio: '16:9', size: '3840x2160' },
  { resolution: '4K', aspectRatio: '9:16', size: '2160x3840' },
  { resolution: '4K', aspectRatio: '4:3', size: '3264x2448' },
  { resolution: '4K', aspectRatio: '3:4', size: '2448x3264' },
  { resolution: '4K', aspectRatio: '4:5', size: '2560x3200' },
  { resolution: '4K', aspectRatio: '5:4', size: '3200x2560' },
  { resolution: '4K', aspectRatio: '2:1', size: '3840x1920' },
  { resolution: '4K', aspectRatio: '1:2', size: '1920x3840' },
  { resolution: '4K', aspectRatio: '21:9', size: '3808x1632' },
  { resolution: '4K', aspectRatio: '9:21', size: '1632x3808' },
  { resolution: '4K', aspectRatio: '3:1', size: '3840x1280' },
  { resolution: '4K', aspectRatio: '1:3', size: '1280x3840' }
]

export function openAIImageSupport(extendedQuality = false): ImageGenerationSupport {
  const mode = {
    maxInputImages: 16,
    canvases: OPENAI_IMAGE_CANVASES,
    supports: {
      imageResolution: {
        type: 'enum' as const,
        render: 'chips' as const,
        options: IMAGE_RESOLUTIONS.filter((value) => ['1K', '2K', '4K'].includes(value)),
        default: '1K'
      },
      aspectRatio: {
        type: 'enum' as const,
        render: 'chips' as const,
        options: IMAGE_ASPECT_RATIOS.filter((ratio) => OPENAI_IMAGE_CANVASES.some((c) => c.aspectRatio === ratio)),
        default: '1:1'
      },
      size: { type: 'enum' as const, options: ['auto', ...OPENAI_IMAGE_CANVASES.map((c) => c.size)] },
      numImages: { type: 'range' as const, min: 1, max: 10, default: 1 },
      quality: {
        type: 'enum' as const,
        options: ['auto', 'low', 'medium', 'high', ...(extendedQuality ? ['xhigh', 'max'] : [])],
        default: 'auto'
      },
      moderation: { type: 'enum' as const, options: ['auto', 'low'], default: 'auto' },
      outputFormat: { type: 'enum' as const, options: ['png', 'jpeg', 'webp'], default: 'png' },
      background: { type: 'enum' as const, options: ['auto', 'opaque', 'transparent'], default: 'auto' },
      outputCompression: { type: 'range' as const, min: 0, max: 100, default: 100 }
    }
  }
  const edit: NonNullable<ImageGenerationSupport['modes']['edit']> = structuredClone(mode)
  delete edit.supports.moderation
  return { modes: { generate: mode, edit } }
}

export const GROK_IMAGE_SUPPORT: ImageGenerationSupport = {
  modes: Object.fromEntries(
    ['generate', 'edit'].map((mode) => [
      mode,
      {
        maxInputImages: 5,
        supports: {
          resolution: { type: 'enum', render: 'chips', options: ['1k', '2k'], default: '1k' },
          aspectRatio: {
            type: 'enum',
            render: 'chips',
            options: [
              'auto',
              ...IMAGE_ASPECT_RATIOS.filter((r) =>
                [
                  '1:1',
                  '16:9',
                  '9:16',
                  '4:3',
                  '3:4',
                  '3:2',
                  '2:3',
                  '2:1',
                  '1:2',
                  '19.5:9',
                  '9:19.5',
                  '20:9',
                  '9:20',
                  '21:9',
                  '5:2'
                ].includes(r)
              )
            ],
            default: 'auto'
          },
          quality: { type: 'enum', options: ['auto', 'low', 'medium'], default: 'auto' },
          numImages: { type: 'range', min: 1, max: 10, default: 1 }
        }
      }
    ])
  )
}

export function withImageEditing(support: ImageGenerationSupport): ImageGenerationSupport {
  const generation = support.modes.generate
  if (!generation) return support
  // Gemini native tiers are not longest-edge limits. Preview only; never send these dimensions.
  const sizes: [string, number, number][] = [
    ['1:1', 1024, 1024],
    ['2:3', 848, 1264],
    ['3:2', 1264, 848],
    ['3:4', 896, 1200],
    ['4:3', 1200, 896],
    ['4:5', 928, 1152],
    ['5:4', 1152, 928],
    ['9:16', 768, 1376],
    ['16:9', 1376, 768],
    ['21:9', 1584, 672],
    ['1:4', 512, 2048],
    ['4:1', 2048, 512],
    ['1:8', 384, 3072],
    ['8:1', 3072, 384]
  ]
  const mode = generation.supports.imageResolution
    ? {
        ...generation,
        expectedSizes: [1, 2, 4].flatMap((scale) =>
          sizes.map(([aspectRatio, width, height]) => ({
            resolution: `${scale}K`,
            aspectRatio,
            size: `${width * scale}x${height * scale}`
          }))
        )
      }
    : generation
  return { ...support, modes: { ...support.modes, generate: mode, edit: { ...mode } } }
}

/** Explicit Seedream canvas requests, selected from the model's declared resolution tiers. */
export function seedreamImageSupport(support: ImageGenerationSupport): ImageGenerationSupport {
  const generation = support.modes.generate
  if (!generation) return support
  const resolution = generation.supports.imageResolution
  const sizes = [
    ['1K', '1:1', '1024x1024'],
    ['2K', '1:1', '2048x2048'],
    ['2K', '16:9', '2560x1440'],
    ['2K', '9:16', '1440x2560'],
    ['2K', '4:3', '2304x1728'],
    ['2K', '3:4', '1728x2304'],
    ['2K', '3:2', '2496x1664'],
    ['2K', '2:3', '1664x2496'],
    ['3K', '1:1', '3072x3072'],
    ['4K', '1:1', '4096x4096'],
    ['4K', '16:9', '3840x2160'],
    ['4K', '9:16', '2160x3840']
  ]
  const canvases = sizes
    .filter(([tier]) => resolution?.type === 'enum' && resolution.options.includes(tier))
    .map(([resolution, aspectRatio, size]) => ({ resolution, aspectRatio, size }))
  const mode = {
    ...generation,
    canvases,
    supports: {
      ...generation.supports,
      aspectRatio: {
        type: 'enum' as const,
        render: 'chips' as const,
        options: IMAGE_ASPECT_RATIOS.filter((ratio) => canvases.some((c) => c.aspectRatio === ratio)),
        default: '1:1'
      }
    }
  }
  return { modes: { generate: mode, edit: mode } }
}
