import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { normalizePathValue } from '@renderer/services/NotesTreeService'
import type { NotesTreeNode } from '@renderer/types/note'
import type { NoteMetadata } from '@shared/data/types/noteMetadata'
import { useCallback, useMemo } from 'react'

const logger = loggerService.withContext('useNoteMetadata')

export function useNoteMetadata(rootPath: string) {
  const normalizedRootPath = useMemo(() => (rootPath ? normalizePathValue(rootPath) : ''), [rootPath])
  const {
    data: metadata = [],
    isLoading,
    isRefreshing,
    error,
    refetch
  } = useQuery('/notes/metadata', {
    query: { rootPath: normalizedRootPath },
    enabled: !!rootPath
  })

  const { trigger: upsertMetadata } = useMutation('PATCH', '/notes/metadata', {
    refresh: ['/notes/metadata']
  })
  const { trigger: deleteMetadata } = useMutation('DELETE', '/notes/metadata', {
    refresh: ['/notes/metadata']
  })
  const { trigger: rewriteMetadataPath } = useMutation('PATCH', '/notes/metadata/path', {
    refresh: ['/notes/metadata']
  })

  const starredPaths = useMemo(() => metadata.filter((item) => item.isStarred).map((item) => item.path), [metadata])
  const expandedPaths = useMemo(() => metadata.filter((item) => item.isExpanded).map((item) => item.path), [metadata])
  const metadataByPath = useMemo(() => new Map(metadata.map((item) => [item.path, item])), [metadata])

  const patchNode = useCallback(
    async (
      node: Pick<NotesTreeNode, 'externalPath' | 'type'>,
      patch: Pick<Partial<NoteMetadata>, 'isStarred' | 'isExpanded'>
    ) => {
      if (!rootPath || node.type === 'hint') {
        return
      }

      try {
        await upsertMetadata({
          body: {
            rootPath: normalizedRootPath,
            path: normalizePathValue(node.externalPath),
            ...patch
          }
        })
      } catch (mutationError) {
        logger.error('Failed to update note metadata', mutationError as Error)
        throw mutationError
      }
    },
    [normalizedRootPath, rootPath, upsertMetadata]
  )

  const removePath = useCallback(
    async (path: string, recursive: boolean) => {
      await deleteMetadata({
        query: {
          rootPath: normalizedRootPath,
          path: normalizePathValue(path),
          recursive
        }
      })
    },
    [deleteMetadata, normalizedRootPath]
  )

  const rewritePath = useCallback(
    async (fromPath: string, toPath: string, recursive: boolean) => {
      await rewriteMetadataPath({
        body: {
          rootPath: normalizedRootPath,
          fromPath: normalizePathValue(fromPath),
          toPath: normalizePathValue(toPath),
          recursive
        }
      })
    },
    [normalizedRootPath, rewriteMetadataPath]
  )

  return {
    metadata,
    metadataByPath,
    starredPaths,
    expandedPaths,
    isLoading,
    isRefreshing,
    error,
    refetch,
    patchNode,
    removePath,
    rewritePath
  }
}
