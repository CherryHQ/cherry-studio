import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { normalizePathValue } from '@renderer/services/NotesTreeService'
import type { NotesTreeNode } from '@renderer/types/note'
import type { Note } from '@shared/data/types/note'
import { useCallback, useMemo } from 'react'

const logger = loggerService.withContext('useNote')

export function useNote(rootPath: string) {
  const normalizedRootPath = useMemo(() => (rootPath ? normalizePathValue(rootPath) : ''), [rootPath])
  const {
    data: notes = [],
    isLoading,
    isRefreshing,
    error,
    refetch
  } = useQuery('/notes', {
    query: { rootPath: normalizedRootPath },
    enabled: !!rootPath
  })

  const { trigger: upsertNote } = useMutation('PATCH', '/notes', {
    refresh: ['/notes']
  })
  const { trigger: deleteNote } = useMutation('DELETE', '/notes', {
    refresh: ['/notes']
  })
  const { trigger: rewriteNotePath } = useMutation('PATCH', '/notes/path', {
    refresh: ['/notes']
  })

  const starredPaths = useMemo(() => notes.filter((item) => item.isStarred).map((item) => item.path), [notes])
  const expandedPaths = useMemo(() => notes.filter((item) => item.isExpanded).map((item) => item.path), [notes])
  const noteByPath = useMemo(() => new Map(notes.map((item) => [item.path, item])), [notes])

  const patchNode = useCallback(
    async (
      node: Pick<NotesTreeNode, 'externalPath' | 'type'>,
      patch: Pick<Partial<Note>, 'isStarred' | 'isExpanded'>
    ) => {
      if (!rootPath || node.type === 'hint') {
        return
      }

      try {
        await upsertNote({
          body: {
            rootPath: normalizedRootPath,
            path: normalizePathValue(node.externalPath),
            ...patch
          }
        })
      } catch (mutationError) {
        logger.error('Failed to update note', mutationError as Error)
        throw mutationError
      }
    },
    [normalizedRootPath, rootPath, upsertNote]
  )

  const removePath = useCallback(
    async (path: string, recursive: boolean) => {
      await deleteNote({
        query: {
          rootPath: normalizedRootPath,
          path: normalizePathValue(path),
          recursive
        }
      })
    },
    [deleteNote, normalizedRootPath]
  )

  const rewritePath = useCallback(
    async (fromPath: string, toPath: string, recursive: boolean) => {
      await rewriteNotePath({
        body: {
          rootPath: normalizedRootPath,
          fromPath: normalizePathValue(fromPath),
          toPath: normalizePathValue(toPath),
          recursive
        }
      })
    },
    [normalizedRootPath, rewriteNotePath]
  )

  return {
    notes,
    noteByPath,
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
