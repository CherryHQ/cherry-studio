import axios from 'axios'
import * as htmlparser2 from 'htmlparser2'
import { useCallback, useEffect, useRef, useState } from 'react'

export function useMetaDataParser<T extends string>(
  link: string,
  properties: readonly T[],
  options?: {
    timeout?: number
  }
) {
  const { timeout = 5000 } = options || {}

  const [metadata, setMetadata] = useState<Record<T, string>>({} as Record<T, string>)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)

  const parseMetadata = useCallback(async () => {
    if (!link || !isLoading) return

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsLoading(true)
    setError(null)

    try {
      const response = await axios.get(link, { timeout, signal: controller.signal })

      const htmlContent = response.data
      const parsedMetadata = {} as Record<T, string>

      const parser = new htmlparser2.Parser({
        onopentag(tagName, attributes) {
          if (tagName === 'meta') {
            const { name: metaName, property: metaProperty, content } = attributes
            const metaKey = metaName || metaProperty
            if (!metaKey || !properties.includes(metaKey as T)) return
            parsedMetadata[metaKey as T] = content
          }
        }
      })

      parser.parseComplete(htmlContent)

      setMetadata(parsedMetadata)
    } catch (err) {
      // Don't set error if request was aborted
      if (axios.isCancel(err) || (err instanceof Error && err.name === 'AbortError')) {
        return
      }
      setError(err instanceof Error ? err : new Error('Failed to fetch HTML'))
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, link, properties, timeout])

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  return {
    metadata,
    isLoading,
    error,
    parseMetadata
  }
}
