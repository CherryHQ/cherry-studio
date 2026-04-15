import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import FileManager from '@renderer/services/FileManager'
import type { DmxapiPainting, FileMetadata } from '@renderer/types'
import { generationModeType } from '@renderer/types'
import { convertToBase64, uuid } from '@renderer/utils'
import type { PaintingMode } from '@shared/data/types/painting'
import type { FC } from 'react'
import { useEffect, useState } from 'react'

import { SettingHelpLink } from '../../settings'
import ImageUploader from '../components/ImageUploader'
import PaintingsSectionTitle from '../components/PaintingsSectionTitle'
import {
  COURSE_URL,
  DEFAULT_PAINTING,
  type DMXApiModelData,
  type DMXApiModelGroups,
  GetModelGroup,
  MODEOPTIONS,
  STYLE_TYPE_OPTIONS,
  TOP_UP_URL
} from '../config/DmxapiConfig'
import { checkProviderEnabled } from '../utils'
import type { GenerateContext, PaintingProviderDefinition } from './types'

// Module-level state for uploaded image files (edit/merge modes)
interface FileMapType {
  imageFiles: FileMetadata[]
  paths: string[]
}

let fileMap: FileMapType = { imageFiles: [], paths: [] }
const fileMapListeners = new Set<() => void>()

function setFileMap(updater: (prev: FileMapType) => FileMapType) {
  fileMap = updater(fileMap)
  fileMapListeners.forEach((fn) => fn())
}

function clearFileMap() {
  fileMap = { imageFiles: [], paths: [] }
  fileMapListeners.forEach((fn) => fn())
}

// Module-level cache for loaded model data
let cachedModelGroups: DMXApiModelGroups | null = null
let cachedAllModels: DMXApiModelData[] = []

function toDmxapiDbMode(mode?: string): PaintingMode {
  if (mode === generationModeType.EDIT) return 'edit'
  if (mode === generationModeType.MERGE) return 'merge'
  return 'generate'
}

function getModelOptionsForMode(mode: string, modelGroups: DMXApiModelGroups | null) {
  if (!modelGroups) return {}
  if (mode === generationModeType.EDIT) return modelGroups.IMAGE_EDIT || {}
  if (mode === generationModeType.MERGE) return modelGroups.IMAGE_MERGE || {}
  return modelGroups.TEXT_TO_IMAGES || {}
}

function getFirstModelInfo(mode: string, modelGroups: DMXApiModelGroups | null) {
  const groups = getModelOptionsForMode(mode, modelGroups)
  let model = ''
  let priceModel = ''
  let image_size = ''
  let extend_params = {}

  for (const provider of Object.keys(groups)) {
    if (groups[provider] && groups[provider].length > 0) {
      model = groups[provider][0].id
      priceModel = groups[provider][0].price
      image_size = groups[provider][0].image_sizes[0].value
      extend_params = (groups[provider][0] as any).extend_params || {}
      break
    }
  }

  return { model, priceModel, image_size, extend_params }
}

const generateRandomSeed = () => Math.floor(Math.random() * 1000000).toString()

// Build config fields that adapt to the loaded model data
function buildConfigFields(): any[] {
  return [
    // Image size select — options depend on current model
    {
      type: 'select',
      key: 'image_size',
      title: 'paintings.image.size',
      options: (_config: any, painting: Record<string, unknown>) => {
        const currentModel = cachedAllModels.find((m) => m.id === painting.model)
        const sizes = (currentModel?.image_sizes || []).map((s) => ({
          label: s.label,
          value: s.value
        }))
        if (currentModel?.is_custom_size) {
          sizes.push({ label: 'paintings.custom_size', value: 'custom' })
        }
        return sizes
      }
    },
    // Custom size inputs — shown when image_size is 'custom'
    {
      type: 'customSize',
      key: 'customSize',
      title: 'paintings.custom_size',
      widthKey: 'customWidth',
      heightKey: 'customHeight',
      sizeKey: 'image_size',
      condition: (painting: Record<string, unknown>) => {
        if (painting.image_size !== 'custom' && !String(painting.image_size || '').match(/^\d+x\d+$/)) return false
        // Check if painting has custom aspect_ratio or if the size is not in model's preset list
        const currentModel = cachedAllModels.find((m) => m.id === painting.model)
        if (!currentModel?.is_custom_size) return false
        const presetValues = (currentModel?.image_sizes || []).map((s) => s.value)
        return !presetValues.includes(String(painting.image_size))
      },
      validation: {
        minWidth: 512,
        maxWidth: 2048,
        minHeight: 512,
        maxHeight: 2048
      }
    },
    // Seed input — only in generation mode
    {
      type: 'input',
      key: 'seed',
      title: 'paintings.seed',
      tooltip: 'paintings.seed_desc_tip',
      condition: (painting: Record<string, unknown>) => {
        return painting.generationMode === generationModeType.GENERATION
      }
    },
    // Style toggle buttons
    {
      type: 'styleToggle',
      key: 'style_type',
      title: 'paintings.style_type',
      toggleMode: 'single' as const,
      options: STYLE_TYPE_OPTIONS.map((s) => ({
        labelKey: s.labelKey,
        value: s.value
      }))
    },
    // Auto-create switch
    {
      type: 'switch',
      key: 'autoCreate',
      title: 'paintings.auto_create_paint',
      tooltip: 'paintings.auto_create_paint_tip'
    }
  ]
}

// Download images utility (handles both URL and base64)
async function downloadImages(urls: string[], t: (key: string) => string): Promise<FileMetadata[]> {
  const downloadedFiles = await Promise.all(
    urls.map(async (url) => {
      try {
        if (!url?.trim()) {
          window.toast.warning(t('message.empty_url'))
          return null
        }
        if (url.startsWith('data:image')) {
          return await window.api.file.saveBase64Image(url)
        }
        return await window.api.file.download(url, true)
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes('Failed to parse URL') || error.message.includes('Invalid URL'))
        ) {
          window.toast.warning(t('message.empty_url'))
        }
        return null
      }
    })
  )
  return downloadedFiles.filter((file): file is FileMetadata => file !== null)
}

export const dmxapiProvider: PaintingProviderDefinition<DmxapiPainting> = {
  providerId: 'dmxapi',

  modes: MODEOPTIONS.map((m) => ({ value: m.value, labelKey: m.labelKey })),
  defaultMode: generationModeType.GENERATION,
  modeToDbMode: (mode: string) => toDmxapiDbMode(mode),

  // Async model loading from external URL
  models: (mode: string) => ({
    type: 'async' as const,
    loader: async () => {
      if (!cachedModelGroups) {
        const data = await GetModelGroup()
        cachedModelGroups = data
        cachedAllModels = Object.values(data).flatMap((group) => Object.values(group).flat())
      }

      const groups = getModelOptionsForMode(mode, cachedModelGroups)
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

  configFields: buildConfigFields(),

  getDefaultPainting: (mode, models) => {
    const generationMode = (mode as generationModeType) || generationModeType.GENERATION
    clearFileMap()

    // If models loaded from async loader, pick first
    if (models && models.length > 0) {
      const first = models[0]
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

    // Fallback: try cached model groups
    const { model, priceModel, image_size, extend_params } = getFirstModelInfo(generationMode, cachedModelGroups)
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
  },

  onModelChange: (modelId, _painting, models) => {
    const model = models.find((m) => m.value === modelId)
    if (model) {
      return {
        model: modelId,
        priceModel: model.price,
        image_size: model.image_sizes?.[0]?.value || '',
        extend_params: model.extend_params || {}
      } as Partial<DmxapiPainting>
    }
    return { model: modelId } as Partial<DmxapiPainting>
  },

  showTranslate: false,

  providerHeaderExtra: (_provider, t) => {
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

  // Sidebar extra: ImageUploader for edit/merge modes, price display
  sidebarExtra: (state) => {
    const { mode, t } = state
    const isEditOrMerge = mode === generationModeType.EDIT || mode === generationModeType.MERGE
    return <DmxapiSidebarExtra mode={mode} isEditOrMerge={isEditOrMerge} t={t} />
  },

  async onGenerate(ctx: GenerateContext<DmxapiPainting>) {
    const { painting, provider, abortController, updatePaintingState, setIsLoading, setGenerating, t } = ctx
    const mode = ctx.mode || generationModeType.GENERATION

    await checkProviderEnabled(provider, t)

    if (!provider.apiKey) {
      window.modal.error({ content: t('error.no_api_key'), centered: true })
      return
    }

    if (!painting.model) {
      window.modal.error({ content: t('error.missing_required_fields'), centered: true })
      return
    }

    if (!painting.prompt) {
      window.modal.error({ content: t('paintings.text_desc_required'), centered: true })
      return
    }

    // Validate image files for edit/merge modes
    if (
      [generationModeType.EDIT, generationModeType.MERGE].includes(mode as generationModeType) &&
      fileMap.imageFiles.length === 0
    ) {
      window.modal.error({ content: t('paintings.image_handle_required'), centered: true })
      return
    }

    // Confirm regeneration if files exist
    // NOTE: autoCreate feature from original page is simplified here.
    // When autoCreate is true, the original page would create a new painting panel.
    // In this provider architecture, we always replace the current painting's files.
    if (painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })
      if (!confirmed) return
      await FileManager.deleteFiles(painting.files)
    }

    const prompt = painting.prompt || ''
    updatePaintingState({ prompt } as Partial<DmxapiPainting>)

    setIsLoading(true)
    setGenerating(true)

    try {
      const requestConfig = await prepareRequestConfig(prompt, painting, mode, provider, t)

      // Call the API
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
        'User-Agent': 'DMXAPI/1.0.0 (https://www.dmxapi.com)',
        ...requestConfig.headerExpand
      }

      const response = await fetch(requestConfig.endpoint, {
        method: 'POST',
        headers,
        body: requestConfig.body,
        signal: abortController.signal
      })

      if (!response.ok) {
        if (response.status === 401) throw new Error('paintings.req_error_token')
        if (response.status === 403) throw new Error('paintings.req_error_no_balance')
        throw new Error('paintings.operation_failed')
      }

      const data = await response.json()
      const urls = data.data.map((item: { url: string; b64_json: string }) => {
        if (item.b64_json) return 'data:image/png;base64,' + item.b64_json
        if (item.url) return item.url
        return ''
      })

      if (urls.length > 0) {
        const validFiles = await downloadImages(urls, t)
        if (validFiles.length > 0) {
          await FileManager.addFiles(validFiles)
          updatePaintingState({ files: validFiles, urls } as Partial<DmxapiPainting>)
        } else {
          window.toast.warning(t('paintings.req_error_text'))
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        window.modal.error({
          content:
            error.message.startsWith('paintings.') || error.message.startsWith('error.')
              ? t(error.message)
              : t('paintings.req_error_text'),
          centered: true
        })
      }
    } finally {
      setIsLoading(false)
      setGenerating(false)
    }
  }
}

// Prepare request config based on mode and model
async function prepareRequestConfig(
  prompt: string,
  painting: DmxapiPainting,
  mode: string,
  provider: { apiHost: string },
  t: (key: string) => string
) {
  const isEditOrMerge = [generationModeType.EDIT, generationModeType.MERGE].includes(mode as generationModeType)

  if (isEditOrMerge && painting.model !== 'seededit-3.0') {
    return prepareV2Request(prompt, painting, provider)
  }
  return await prepareV1Request(prompt, painting, provider, t)
}

async function prepareV1Request(
  prompt: string,
  painting: DmxapiPainting,
  provider: { apiHost: string },
  t: (key: string) => string
) {
  const params: Record<string, any> = {
    prompt,
    model: painting.model,
    n: painting.n,
    ...painting.extend_params
  }

  if (painting.image_size) params.size = painting.image_size
  if (painting.seed && Number(painting.seed) >= -1) {
    params.seed = Number(painting.seed)
  } else if (painting.seed) {
    params.seed = -1
  }

  if (painting.style_type) {
    params.prompt = prompt + t('paintings.dmxapi.style') + painting.style_type
  }

  if (fileMap.imageFiles.length > 0) {
    const imageFile = fileMap.imageFiles[0]
    if (imageFile instanceof File) {
      params.image = await convertToBase64(imageFile)
    }
  }

  return {
    body: JSON.stringify(params),
    headerExpand: { 'Content-Type': 'application/json' },
    endpoint: `${provider.apiHost}/v1/images/generations`
  }
}

function prepareV2Request(prompt: string, painting: DmxapiPainting, provider: { apiHost: string }) {
  const params: Record<string, any> = {
    prompt,
    n: painting.n,
    model: painting.model,
    ...painting.extend_params
  }

  if (painting.image_size) params.size = painting.image_size
  if (painting.style_type) {
    params.prompt = prompt + ' style: ' + painting.style_type
  }

  const formData = new FormData()
  for (const key in params) {
    formData.append(key, params[key])
  }

  if (fileMap.imageFiles.length > 0) {
    fileMap.imageFiles.forEach((file) => {
      formData.append('image', file as unknown as Blob)
    })
  }

  return {
    body: formData as any,
    headerExpand: undefined,
    endpoint: `${provider.apiHost}/v1/images/edits`
  }
}

// Sidebar extra component for ImageUploader + price display
const DmxapiSidebarExtra: FC<{
  mode: string
  isEditOrMerge: boolean
  t: (key: string) => string
}> = ({ mode, isEditOrMerge, t }) => {
  // Re-render when fileMap changes
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = () => setTick((t) => t + 1)
    fileMapListeners.add(listener)
    return () => {
      fileMapListeners.delete(listener)
    }
  }, [])

  const handleAddImage = (file: File, index?: number) => {
    const path = URL.createObjectURL(file)

    setFileMap((prev) => {
      const currentFiles = [...prev.imageFiles]
      const currentPaths = [...prev.paths]

      if (index !== undefined) {
        currentFiles[index] = file as unknown as FileMetadata
        currentPaths[index] = path
      } else {
        currentFiles.push(file as unknown as FileMetadata)
        currentPaths.push(path)
      }

      return { imageFiles: currentFiles, paths: currentPaths }
    })
  }

  const handleDeleteImage = (index: number) => {
    setFileMap((prev) => {
      const newPaths = [...prev.paths]
      const newFiles = [...prev.imageFiles]
      newPaths.splice(index, 1)
      newFiles.splice(index, 1)
      return { imageFiles: newFiles, paths: newPaths }
    })
  }

  if (!isEditOrMerge) return null

  return (
    <>
      <PaintingsSectionTitle>{t('paintings.remix.image_file')}</PaintingsSectionTitle>
      <ImageUploader
        fileMap={fileMap}
        maxImages={mode === generationModeType.EDIT ? 1 : 3}
        onClearImages={clearFileMap}
        onDeleteImage={handleDeleteImage}
        onAddImage={handleAddImage}
        mode={mode}
      />
    </>
  )
}
