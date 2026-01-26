/**
 * File Processor Hooks
 *
 * React hooks for accessing and managing file processors via DataApi.
 * Processors are fetched from the backend which handles configuration merging
 * and availability checking.
 */

import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import type { FileProcessorFeature, FileProcessorOverride } from '@shared/data/presets/fileProcessing'
import type { ProcessingResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Hook for accessing file processors with merged configurations
 *
 * Fetches processors from the backend via DataApi. The backend handles:
 * - Configuration merging (template + user overrides)
 * - Availability checking
 *
 * @param options.feature - Optional feature filter (text_extraction, markdown_conversion)
 *
 * For updating individual processors, use useFileProcessor(processorId).
 */
export function useFileProcessors(options?: { feature?: FileProcessorFeature }) {
  const { data, isLoading } = useQuery('/file-processing/processors', { query: options })
  const processors = useMemo(() => data ?? [], [data])

  return { processors, isLoading }
}

/**
 * Hook for accessing a single processor by ID
 *
 * Fetches all processors and filters by ID. The GET /file-processing/processors/:id
 * endpoint exists for direct API calls but useQuery doesn't support parameterized paths.
 */
export function useFileProcessor(processorId: string) {
  const { data: processor, isLoading } = useQuery(`/file-processing/processors/${processorId}`, {})

  const { trigger: patchProcessor, isLoading: isUpdating } = useMutation(
    'PATCH',
    `/file-processing/processors/${processorId}`,
    {
      refresh: ['/file-processing/processors']
    }
  )

  const updateProcessor = useCallback(
    async (update: FileProcessorOverride) => {
      await patchProcessor({ body: update })
    },
    [patchProcessor]
  )

  return {
    processor,
    isLoading,
    isUpdating,
    updateProcessor
  }
}

/**
 * Hook for managing default processors
 *
 * Default processor IDs are stored in preferences, not fetched from API.
 */
export function useDefaultProcessors() {
  const [defaultMarkdownConversionProcessor, setDefaultMarkdownConversionProcessor] = usePreference(
    'feature.file_processing.default_markdown_conversion_processor'
  )
  const [defaultTextExtractionProcessor, setDefaultTextExtractionProcessor] = usePreference(
    'feature.file_processing.default_text_extraction_processor'
  )

  return {
    defaultMarkdownConversionProcessor,
    setDefaultMarkdownConversionProcessor,
    defaultTextExtractionProcessor,
    setDefaultTextExtractionProcessor
  }
}

// ============================================================================
// Processing Hooks
// ============================================================================

/**
 * Hook for processing files via the async API
 *
 * Uses useQuery with refreshInterval for automatic polling instead of manual loop.
 */
export function useFileProcess() {
  const [requestId, setRequestId] = useState<string | null>(null)
  const callbacksRef = useRef<{
    resolve: (result: ProcessingResult) => void
    reject: (error: Error) => void
  } | null>(null)

  const { trigger: startProcess } = useMutation('POST', '/file-processing/process', {})

  // TODO: need refactor translate page
  const { data: resultData } = useQuery('/file-processing/result', {
    query: { requestId: requestId ?? '' },
    enabled: !!requestId,
    swrOptions: {
      refreshInterval: 2000
    }
  })

  useEffect(() => {
    if (!resultData || !callbacksRef.current) return

    if (resultData.status === 'completed') {
      callbacksRef.current.resolve(resultData.result!)
      callbacksRef.current = null
      setRequestId(null)
    } else if (resultData.status === 'failed') {
      callbacksRef.current.reject(new Error(resultData.error?.message || 'Processing failed'))
      callbacksRef.current = null
      setRequestId(null)
    }
  }, [resultData])

  const processFile = useCallback(
    (file: FileMetadata, feature: FileProcessorFeature, processorId?: string): Promise<ProcessingResult> => {
      return new Promise((resolve, reject) => {
        startProcess({ body: { file, feature, processorId } })
          .then(({ requestId }) => {
            callbacksRef.current = { resolve, reject }
            setRequestId(requestId)
          })
          .catch(reject)
      })
    },
    [startProcess]
  )

  return { processFile }
}
