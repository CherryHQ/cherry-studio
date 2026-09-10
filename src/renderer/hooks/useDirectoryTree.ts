import { DirectoryTreeSession, type DirectoryTreeState } from '@renderer/services/DirectoryTreeSession'
import type { DirectoryTreeOptions, TreeMutationEvent, TreeNode } from '@shared/utils/file'
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'

export interface UseDirectoryTreeResult extends DirectoryTreeState {
  getNode(absPath: string): TreeNode | null
}

const EMPTY: DirectoryTreeState = { root: null, treeId: null, isLoading: false, error: null, version: 0 }
const emptySnapshot = () => EMPTY
const emptySubscribe = () => () => undefined
const emptyNode = () => null

/**
 * @param onMutation Receives every revision after the mirror applies it, including activation replay
 *   and brief Activity suspension. Changing roots immediately retires the old stream.
 */
export function useDirectoryTree(
  rootPath: string | undefined,
  options?: DirectoryTreeOptions,
  onMutation?: (event: TreeMutationEvent) => void
): UseDirectoryTreeResult {
  const inputs = useRef({ rootPath, options, onMutation })
  inputs.current = { rootPath, options, onMutation }
  const session = useMemo(
    () =>
      rootPath
        ? new DirectoryTreeSession(rootPath, inputs.current.options, (event) => {
            if (inputs.current.rootPath === rootPath) inputs.current.onMutation?.(event)
          })
        : undefined,
    [rootPath]
  )
  const previous = useRef(session)
  useLayoutEffect(() => {
    if (previous.current !== session) previous.current?.dispose()
    previous.current = session
  }, [session])
  const state = useSyncExternalStore(session?.subscribe ?? emptySubscribe, session?.getSnapshot ?? emptySnapshot)
  return { ...state, getNode: session?.getNode ?? emptyNode }
}
