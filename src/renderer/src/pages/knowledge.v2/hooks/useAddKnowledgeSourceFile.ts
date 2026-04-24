import { useInvalidateCache, useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useAddKnowledgeSourceFile')

const resolveFilePath = (file: File): string => {
  const filePath = window.api.file.getPathForFile(file)

  if (!filePath) {
    throw new Error(`Failed to resolve a local path for "${file.name}"`)
  }

  return filePath
}

const resolveFileMetadata = async (file: File): Promise<FileMetadata> => {
  const filePath = resolveFilePath(file)
  const metadata = await window.api.file.get(filePath)

  if (!metadata) {
    throw new Error(`Failed to read file metadata for "${file.name}"`)
  }

  return metadata
}

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }

  return new Error('Failed to add the selected files')
}

export const useAddKnowledgeSourceFile = (baseId: string, files: File[]) => {
  const [error, setError] = useState<Error | undefined>()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isMountedRef = useRef(true)
  const invalidateCache = useInvalidateCache()
  const { trigger: createKnowledgeItems } = useMutation('POST', '/knowledge-bases/:id/items')

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const submit = useCallback(async () => {
    if (!baseId) {
      throw new Error('Knowledge base id is required')
    }

    if (files.length === 0) {
      throw new Error('At least one file must be selected')
    }

    if (isMountedRef.current) {
      setError(undefined)
      setIsSubmitting(true)
    }

    try {
      const externalFiles = await Promise.all(files.map(resolveFileMetadata))
      const uploadedFiles = await FileManager.uploadFiles(externalFiles)
      const result = await createKnowledgeItems({
        params: { id: baseId },
        body: {
          items: uploadedFiles.map((file) => ({
            type: 'file' as const,
            data: { file }
          }))
        }
      })
      const itemIds = result.items.map((item) => item.id)

      if (itemIds.length === 0) {
        throw new Error('No knowledge items were created')
      }

      await invalidateCache(`/knowledge-bases/${baseId}/items`)
      window.api.knowledgeRuntime.addItems(baseId, itemIds).catch((error: unknown) => {
        logger.error('Failed to enqueue file knowledge sources for indexing', {
          baseId,
          itemIds,
          error: normalizeError(error)
        })
      })
    } catch (error) {
      const submitError = normalizeError(error)

      logger.error('Failed to add file knowledge sources', {
        baseId,
        fileCount: files.length,
        error: submitError
      })

      if (isMountedRef.current) {
        setError(submitError)
      }

      throw submitError
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false)
      }
    }
  }, [baseId, createKnowledgeItems, files, invalidateCache])

  return {
    submit,
    isSubmitting,
    error
  }
}
