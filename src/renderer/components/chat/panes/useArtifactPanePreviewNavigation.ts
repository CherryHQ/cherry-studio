import { ipcApi } from '@renderer/ipc'
import type { InputFilePreview } from '@renderer/types/inputFilePreview'
import { createFilePathHandle } from '@shared/utils/file'
import { useCallback, useEffect, useRef } from 'react'

import type { ArtifactPaneFileSelection } from './artifactPanePath'
import { getArtifactPaneSelectionPath, isUncPath, resolveArtifactPaneFileSelection } from './artifactPanePath'
import { useRightPanelActions, useRightPanelState } from './Shell'

interface PreviewReturnTarget {
  closePane: boolean
  panelId?: string
  selection: ArtifactPaneFileSelection | null
}

interface UseArtifactPanePreviewNavigationOptions {
  enabled?: boolean
  paneId: string
  previewFileSelection: ArtifactPaneFileSelection | null
  requestFileSelection: (selection: ArtifactPaneFileSelection | null) => void
  scopeKey?: string
  workspacePath?: string
}

function createInputFileSelection(
  input: InputFilePreview,
  workspacePath: string | undefined,
  previewPath: InputFilePreview['previewPath']
): ArtifactPaneFileSelection | null {
  const selection = resolveArtifactPaneFileSelection(workspacePath, previewPath)
  if (!selection) return null

  return {
    ...selection,
    displayName: input.displayName,
    displayPath: input.originalPath ?? previewPath,
    previewType: 'file',
    readOnly: true
  }
}

export function useArtifactPanePreviewNavigation({
  enabled = true,
  paneId,
  previewFileSelection,
  requestFileSelection,
  scopeKey,
  workspacePath
}: UseArtifactPanePreviewNavigationOptions) {
  const panelActions = useRightPanelActions()
  const panelState = useRightPanelState()
  const requestRef = useRef(0)
  const returnRef = useRef<PreviewReturnTarget | null>(null)

  useEffect(() => {
    return () => {
      requestRef.current += 1
      returnRef.current = null
    }
  }, [scopeKey, workspacePath])

  const beginPreview = useCallback(() => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    if (!returnRef.current || !panelState.presentationOpen || panelState.activePanelId !== paneId) {
      returnRef.current = {
        closePane: !panelState.presentationOpen,
        panelId: panelState.presentationOpen ? panelState.activePanelId : undefined,
        selection: previewFileSelection
      }
    }
    panelActions.requestOpen(paneId, { userInitiated: true })
    return requestId
  }, [paneId, panelActions, panelState.activePanelId, panelState.presentationOpen, previewFileSelection])

  const isCurrentRequest = useCallback((requestId: number) => requestRef.current === requestId, [])

  const validateSelection = useCallback(
    async (selection: ArtifactPaneFileSelection, requestId: number) => {
      try {
        const metadata = await ipcApi.request(
          'file.get_metadata',
          createFilePathHandle(getArtifactPaneSelectionPath(selection))
        )
        if (!isCurrentRequest(requestId)) return
        requestFileSelection(metadata?.kind === 'directory' ? null : selection)
      } catch {
        if (!isCurrentRequest(requestId)) return
        requestFileSelection(selection)
      }
    },
    [isCurrentRequest, requestFileSelection]
  )

  const previewInputFile = useCallback(
    (input: InputFilePreview) => {
      if (!enabled) return
      const requestId = beginPreview()
      const initialSelection = createInputFileSelection(input, workspacePath, input.previewPath)
      if (!initialSelection) {
        requestFileSelection(null)
        return
      }
      requestFileSelection(initialSelection)

      void (async () => {
        let previewPath = input.previewPath

        if (input.originalPath && input.originalPath !== input.previewPath && !isUncPath(input.originalPath)) {
          try {
            const originalMetadata = await ipcApi.request('file.get_metadata', createFilePathHandle(input.originalPath))
            if (!isCurrentRequest(requestId)) return
            if (originalMetadata?.kind === 'file') previewPath = input.originalPath
          } catch {
            if (!isCurrentRequest(requestId)) return
          }
        }

        const selection = createInputFileSelection(input, workspacePath, previewPath)
        if (!selection) {
          if (isCurrentRequest(requestId)) requestFileSelection(null)
          return
        }
        await validateSelection(selection, requestId)
      })()
    },
    [beginPreview, enabled, isCurrentRequest, requestFileSelection, validateSelection, workspacePath]
  )

  const closeFilePreview = useCallback(() => {
    requestRef.current += 1
    const returnTarget = returnRef.current
    returnRef.current = null
    requestFileSelection(returnTarget?.selection ?? null)

    if (!returnTarget) return
    if (returnTarget.closePane) {
      panelActions.close()
      return
    }
    if (returnTarget.panelId) panelActions.requestOpen(returnTarget.panelId)
  }, [panelActions, requestFileSelection])

  const clearReturnTarget = useCallback(() => {
    requestRef.current += 1
    returnRef.current = null
  }, [])

  return { clearReturnTarget, closeFilePreview, previewInputFile }
}
