import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { normalizePathValue } from '@renderer/services/NotesTreeService'
import type { NotesTreeNode } from '@renderer/types/note'
import type { Note } from '@shared/data/types/note'
import { useCallback, useMemo } from 'react'

const logger = loggerService.withContext('useNote')

export function useNote(rootPath: string) {
  const normalizedRootPath = useMemo(() => (rootPath.trim() ? normalizePathValue(rootPath.trim()) : ''), [rootPath])
  const { data: notes = [] } = useQuery('/notes', {
    query: { rootPath: normalizedRootPath },
    enabled: !!normalizedRootPath
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

  const noteByPath = useMemo(() => new Map(notes.map((item) => [item.path, item])), [notes])

  const patchNode = useCallback(
    async (
      node: Pick<NotesTreeNode, 'externalPath' | 'type'>,
      patch: Pick<Partial<Note>, 'isStarred' | 'isExpanded'>
    ) => {
      if (!rootPath.trim() || node.type === 'hint') {
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
      try {
        await deleteNote({
          query: {
            rootPath: normalizedRootPath,
            path: normalizePathValue(path),
            recursive
          }
        })
      } catch (mutationError) {
        logger.error('Failed to delete note metadata path', mutationError as Error)
        throw mutationError
      }
    },
    [deleteNote, normalizedRootPath]
  )

  const rewritePath = useCallback(
    async (fromPath: string, toPath: string, recursive: boolean) => {
      try {
        await rewriteNotePath({
          body: {
            rootPath: normalizedRootPath,
            fromPath: normalizePathValue(fromPath),
            toPath: normalizePathValue(toPath),
            recursive
          }
        })
      } catch (mutationError) {
        logger.error('Failed to rewrite note metadata path', mutationError as Error)
        throw mutationError
      }
    },
    [normalizedRootPath, rewriteNotePath]
  )

  return {
    notes,
    noteByPath,
    patchNode,
    removePath,
    rewritePath
  }
}
