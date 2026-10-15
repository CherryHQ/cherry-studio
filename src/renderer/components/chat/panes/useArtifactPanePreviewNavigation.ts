import { useCallback, useEffect, useRef } from 'react'

import { ipcApi } from '@renderer/ipc'
import type { InputFilePreview } from '@renderer/types/inputFilePreview'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'

import type { ArtifactPaneFileSelection } from './artifactPanePath'
import { getArtifactPaneSelectionPath, resolveArtifactPaneFileSelection } from './artifactPanePath'
import { useRightPanelActions, useRightPanelState } from './Shell'

interface PreviewReturnTarget {
  closePane: boolean
  panelId?: string
  previous?: PreviewReturnTarget
  selection: ArtifactPaneFileSelection | null
}

interface SelectionGeneration {
  current: number
}

interface UseArtifactPanePreviewNavigationOptions {
  enabled?: boolean
  paneId: string
  previewFileSelection: ArtifactPaneFileSelection | null
  requestFileSelection: (selection: ArtifactPaneFileSelection | null, onAccepted?: () => void) => void
  /** Shared with other file navigations so a newer artifact or attachment wins. */
  selectionGenerationRef?: SelectionGeneration
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
  selectionGenerationRef,
  scopeKey,
  workspacePath
}: UseArtifactPanePreviewNavigationOptions) {
  const panelActions = useRightPanelActions()
  const panelState = useRightPanelState()
  const localRequestRef = useRef(0)
  const requestRef = selectionGenerationRef ?? localRequestRef
  const returnRef = useRef<PreviewReturnTarget | null>(null)

  useEffect(() => {
    return () => {
      requestRef.current += 1
      returnRef.current = null
    }
  }, [requestRef, scopeKey, workspacePath])

  const beginRequest = useCallback(() => {
    requestRef.current += 1
    return requestRef.current
  }, [requestRef])

  const isCurrentRequest = useCallback((requestId: number) => requestRef.current === requestId, [requestRef])

  const rememberPreviewReturnTarget = useCallback(() => {
    if (!returnRef.current || !panelState.presentationOpen || panelState.activePanelId !== paneId) {
      returnRef.current = {
        closePane: !panelState.presentationOpen,
        panelId: panelState.presentationOpen ? panelState.activePanelId : undefined,
        selection: previewFileSelection
      }
    }
  }, [paneId, panelState.activePanelId, panelState.presentationOpen, previewFileSelection])

  const validateSelection = useCallback(
    async (selection: ArtifactPaneFileSelection, requestId: number, onCommit?: () => void) => {
      let nextSelection: ArtifactPaneFileSelection | null = selection
      try {
        const metadata = await ipcApi.request(
          'file.get_metadata',
          createFilePathHandle(getArtifactPaneSelectionPath(selection))
        )
        if (metadata?.kind === 'directory') nextSelection = null
      } catch {
        // Keep inaccessible files selected so the preview can report the error.
      }
      if (!isCurrentRequest(requestId) || !nextSelection) return
      requestFileSelection(nextSelection, () => {
        onCommit?.()
        panelActions.requestOpen(paneId, { userInitiated: true })
      })
    },
    [isCurrentRequest, paneId, panelActions, requestFileSelection]
  )

  const captureInputPreviewReturnTarget = useCallback(() => {
    if (!previewFileSelection || (previewFileSelection.previewType !== 'file' && !returnRef.current)) return
    returnRef.current = {
      closePane: false,
      panelId: paneId,
      previous: returnRef.current ?? undefined,
      selection: previewFileSelection
    }
  }, [paneId, previewFileSelection])

  const previewInputFile = useCallback(
    (input: InputFilePreview) => {
      if (!enabled) return
      if (!createInputFileSelection(input, workspacePath, input.previewPath)) return

      const requestId = beginRequest()
      void (async () => {
        let previewPath = input.previewPath

        if (input.originalPath && input.originalPath !== input.previewPath) {
          try {
            const originalMetadata = await ipcApi.request('file.get_metadata', createFilePathHandle(input.originalPath))
            if (!isCurrentRequest(requestId)) return
            if (originalMetadata?.kind === 'file') {
              await ipcApi.request('file.read', {
                handle: createFilePathHandle(input.originalPath),
                options: { mode: 'range', offset: 0, length: 1 }
              })
              if (!isCurrentRequest(requestId)) return
              previewPath = input.originalPath
            }
          } catch {
            if (!isCurrentRequest(requestId)) return
          }
        }

        if (previewPath === input.previewPath && input.fileEntryId) {
          try {
            const managedPath = await window.api.file.getPhysicalPath({ id: input.fileEntryId })
            if (!isCurrentRequest(requestId)) return
            previewPath = AbsoluteFilePathSchema.safeParse(managedPath).data ?? input.previewPath
          } catch {
            if (!isCurrentRequest(requestId)) return
          }
        }

        if (!isCurrentRequest(requestId)) return
        const selection =
          createInputFileSelection(input, workspacePath, previewPath) ??
          (previewPath === input.previewPath ? null : createInputFileSelection(input, workspacePath, input.previewPath))
        if (!selection) return
        await validateSelection(selection, requestId, () => {
          captureInputPreviewReturnTarget()
          rememberPreviewReturnTarget()
        })
      })()
    },
    [
      beginRequest,
      captureInputPreviewReturnTarget,
      enabled,
      isCurrentRequest,
      rememberPreviewReturnTarget,
      validateSelection,
      workspacePath
    ]
  )

  const closeFilePreview = useCallback(() => {
    beginRequest()
    const returnTarget = returnRef.current
    requestFileSelection(returnTarget?.selection ?? null, () => {
      if (returnRef.current !== returnTarget) return
      returnRef.current = returnTarget?.previous ?? null
      if (!returnTarget) return
      if (returnTarget.closePane) {
        panelActions.close()
        return
      }
      if (returnTarget.panelId) panelActions.requestOpen(returnTarget.panelId)
    })
  }, [beginRequest, panelActions, requestFileSelection])

  const clearReturnTarget = useCallback(() => {
    requestRef.current += 1
    returnRef.current = null
  }, [requestRef])

  return { captureInputPreviewReturnTarget, clearReturnTarget, closeFilePreview, previewInputFile }
}
