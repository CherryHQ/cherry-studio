import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useBundledCatalog')

type BundledCatalogLoader<TItem> = (resourcesPath: string, language: string) => Promise<TItem[]>

interface UseBundledCatalogOptions<TItem> {
  catalog: string
  enabled?: boolean
  load: BundledCatalogLoader<TItem>
}

export function useBundledCatalog<TItem>({ catalog, enabled = true, load }: UseBundledCatalogOptions<TItem>) {
  const { i18n } = useTranslation()
  const language = i18n?.resolvedLanguage ?? i18n?.language ?? 'en-US'
  const [resourcesPath] = useCache('app.path.resources')
  const [items, setItems] = useState<TItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const loadedCatalogRef = useRef<{
    catalog: string
    items: TItem[]
    language: string
    load: BundledCatalogLoader<TItem>
    resourcesPath: string
  } | null>(null)

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      return
    }

    if (!resourcesPath) {
      logger.warn('Bundled catalog resources path is not ready', { catalog })
      setItems([])
      setIsLoading(false)
      return
    }

    // Activity reconnects effects when a tab becomes visible; reuse matching loaded data
    // so returning to a tab cannot re-read or reorder its catalog.
    const loadedCatalog = loadedCatalogRef.current
    if (
      loadedCatalog?.catalog === catalog &&
      loadedCatalog.language === language &&
      loadedCatalog.load === load &&
      loadedCatalog.resourcesPath === resourcesPath
    ) {
      setItems(loadedCatalog.items)
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)

    void load(resourcesPath, language)
      .then((loadedItems) => {
        if (!cancelled) {
          loadedCatalogRef.current = { catalog, items: loadedItems, language, load, resourcesPath }
          setItems(loadedItems)
        }
      })
      .catch((error) => {
        if (cancelled) return
        logger.error('Failed to load bundled catalog', { catalog, error })
        setItems([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [catalog, enabled, language, load, resourcesPath])

  return {
    isLoading,
    items
  }
}
