import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'

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
  const [isLoading, setIsLoading] = useState(enabled)
  const [error, setError] = useState<Error | null>(null)
  const [revision, setRevision] = useState(0)
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
      setIsLoading(true)
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
      setError(null)
      setItems(loadedCatalog.items)
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)
    setItems([])

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
        setError(error instanceof Error ? error : new Error(String(error)))
        setItems([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [catalog, enabled, language, load, resourcesPath, revision])

  const retry = useCallback(() => {
    loadedCatalogRef.current = null
    setRevision((value) => value + 1)
  }, [])

  return {
    error,
    retry,
    isLoading,
    items
  }
}
