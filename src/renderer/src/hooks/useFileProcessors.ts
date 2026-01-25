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
import { useCallback, useMemo } from 'react'

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
 * @param options.feature - Optional feature filter (text_extraction, to_markdown)
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
  const [defaultDocumentProcessor, setDefaultDocumentProcessor] = usePreference(
    'feature.file_processing.default_document_processor'
  )
  const [defaultImageProcessor, setDefaultImageProcessor] = usePreference(
    'feature.file_processing.default_image_processor'
  )

  return {
    defaultDocumentProcessor,
    setDefaultDocumentProcessor,
    defaultImageProcessor,
    setDefaultImageProcessor
  }
}
