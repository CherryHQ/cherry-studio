import { useBundledCatalog } from '@renderer/hooks/useBundledCatalog'
import { joinPath } from '@renderer/utils/path'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { toFileUrl } from '@shared/utils/file'

const PAINTING_TEMPLATE_RESOURCE_DIRECTORY = 'data/painting-templates'
const PAINTING_TEMPLATE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface PaintingTemplateTranslation {
  label: string
  prompt: string
}

export interface PaintingTemplatePreset extends PaintingTemplateTranslation {
  id: string
  imageUrl: string
}

function normalizeManifest(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value.filter((item): item is string => typeof item === 'string' && PAINTING_TEMPLATE_ID_PATTERN.test(item))
}

function normalizeTranslations(value: unknown): Record<string, PaintingTemplateTranslation> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, PaintingTemplateTranslation] => {
      const translation = entry[1]
      return Boolean(
        translation &&
          typeof translation === 'object' &&
          typeof (translation as PaintingTemplateTranslation).label === 'string' &&
          typeof (translation as PaintingTemplateTranslation).prompt === 'string'
      )
    })
  )
}

function getLocaleFileName(language: string) {
  return language.toLowerCase() === 'zh-cn' ? 'zh-cn.json' : 'en-us.json'
}

async function loadPaintingTemplateCatalog(resourcesPath: string, language: string): Promise<PaintingTemplatePreset[]> {
  const resourceRoot = joinPath(resourcesPath, PAINTING_TEMPLATE_RESOURCE_DIRECTORY)
  const [manifestContent, translationContent] = await Promise.all([
    window.api.fs.read(joinPath(resourceRoot, 'catalog.json'), 'utf-8'),
    window.api.fs.read(joinPath(resourceRoot, `locales/${getLocaleFileName(language)}`), 'utf-8')
  ])
  const manifest = normalizeManifest(JSON.parse(manifestContent))
  const translations = normalizeTranslations(JSON.parse(translationContent))

  return manifest.map((id) => {
    const translation = translations[id]
    if (!translation) {
      throw new Error(`Missing painting template translation: ${id}`)
    }

    const previewPath = AbsoluteFilePathSchema.parse(joinPath(resourceRoot, `images/${id}.webp`))
    return {
      id,
      imageUrl: toFileUrl(previewPath),
      ...translation
    }
  })
}

export function usePaintingTemplateCatalog() {
  const { items: templates } = useBundledCatalog({
    catalog: 'painting templates',
    load: loadPaintingTemplateCatalog
  })

  return {
    templates
  }
}
