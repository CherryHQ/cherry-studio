import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { joinPath } from '@renderer/utils/path'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { toFileUrl } from '@shared/utils/file'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const PAINTING_TEMPLATE_RESOURCE_DIRECTORY = 'data/painting-templates'
const logger = loggerService.withContext('usePaintingTemplateCatalog')

interface PaintingTemplateManifestItem {
  id: string
  preview: string
}

interface PaintingTemplateTranslation {
  label: string
  prompt: string
}

export interface PaintingTemplatePreset extends PaintingTemplateTranslation {
  id: string
  imageUrl: string
}

function normalizeManifest(value: unknown): PaintingTemplateManifestItem[] {
  if (!Array.isArray(value)) return []

  return value.filter((item): item is PaintingTemplateManifestItem => {
    return Boolean(
      item &&
        typeof item === 'object' &&
        typeof (item as PaintingTemplateManifestItem).id === 'string' &&
        typeof (item as PaintingTemplateManifestItem).preview === 'string'
    )
  })
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

async function readCatalog(resourcesPath: string, language: string): Promise<PaintingTemplatePreset[]> {
  const resourceRoot = joinPath(resourcesPath, PAINTING_TEMPLATE_RESOURCE_DIRECTORY)
  const [manifestContent, translationContent] = await Promise.all([
    window.api.fs.read(joinPath(resourceRoot, 'catalog.json'), 'utf-8'),
    window.api.fs.read(joinPath(resourceRoot, `locales/${getLocaleFileName(language)}`), 'utf-8')
  ])
  const manifest = normalizeManifest(JSON.parse(manifestContent))
  const translations = normalizeTranslations(JSON.parse(translationContent))

  return manifest.map((item) => {
    const translation = translations[item.id]
    if (!translation) {
      throw new Error(`Missing painting template translation: ${item.id}`)
    }

    const previewPath = AbsoluteFilePathSchema.parse(joinPath(resourceRoot, item.preview))
    return {
      id: item.id,
      imageUrl: toFileUrl(previewPath),
      ...translation
    }
  })
}

async function loadCatalog(resourcesPath: string, language: string) {
  if (!resourcesPath) {
    logger.warn('resourcesPath not ready yet, returning an empty painting template catalog')
    return []
  }

  try {
    return await readCatalog(resourcesPath, language)
  } catch (error) {
    logger.error('Failed to load the bundled painting template catalog', error as Error)
    return []
  }
}

export function usePaintingTemplateCatalog() {
  const { i18n } = useTranslation()
  const language = i18n?.resolvedLanguage ?? i18n?.language ?? 'en-US'
  const [resourcesPath] = useCache('app.path.resources')
  const [templates, setTemplates] = useState<PaintingTemplatePreset[]>([])

  useEffect(() => {
    let cancelled = false

    void loadCatalog(resourcesPath, language)
      .then((loadedTemplates) => {
        if (!cancelled) setTemplates(loadedTemplates)
      })
      .catch((error) => {
        logger.error('Unexpected failure while loading the painting template catalog', error as Error)
      })

    return () => {
      cancelled = true
    }
  }, [language, resourcesPath])

  return {
    templates
  }
}
