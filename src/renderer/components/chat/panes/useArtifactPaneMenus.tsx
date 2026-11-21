import type { TFunction } from 'i18next'
import { AtSign, Copy } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import type { CommandContextMenuExtraItem } from '@renderer/components/command'
import { loadOpenTargetMenuItems } from '@renderer/components/OpenTarget'
import { FILE_EDIT_MAX_SIZE_BYTES as ARTIFACT_PREVIEW_MAX_SIZE_BYTES } from '@renderer/hooks/useFileEditSession'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { getFileExtension } from '@renderer/utils/file'
import { isWin } from '@renderer/utils/platform'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'

import {
  type ArtifactPaneFileSelection,
  getArtifactPaneSelectionPath,
  getArtifactPaneSelectionDisplayPath,
  getArtifactPaneSelectionRelativePath,
  getCopyableAbsolutePath,
  getPathBasename
} from './artifactPanePath'

const logger = loggerService.withContext('ArtifactPaneMenus')
const DOCUMENT_CONTENT_COPY_MAX_SIZE_BYTES = 25 * 1024 * 1024
const COPYABLE_DOCUMENT_EXTENSIONS = new Set(['.doc', '.docx'])
const NON_TEXT_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.odp', '.ods'])
const getPreviewFileTitle = (selection: ArtifactPaneFileSelection) =>
  selection.displayName ?? getPathBasename(selection.filePath)

type CopyFileState = 'ready' | 'checking' | 'unavailable'

export async function getCopyFileState(path: string): Promise<CopyFileState> {
  try {
    const status = await ipcApi.request(
      'file.get_clipboard_status',
      createFilePathHandle(AbsoluteFilePathSchema.parse(path))
    )
    return status.ok ? 'ready' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/** The shared "Copy" submenu for a file or folder in the tree and the open-file header. */
export function buildCopyMenu({
  t,
  copy,
  onCopyContent,
  absolutePath,
  relativePath,
  fileName,
  copyFile
}: {
  t: TFunction
  copy: (text: string) => void
  onCopyContent?: () => void
  absolutePath: string
  relativePath: string | null
  fileName: string
  copyFile: { state: CopyFileState; onSelect: () => void }
}): CommandContextMenuExtraItem {
  return {
    type: 'submenu',
    id: 'artifact-pane.file.copy',
    label: t('common.copy'),
    icon: <Copy size={14} />,
    children: [
      ...(onCopyContent
        ? [
            {
              type: 'item' as const,
              id: 'artifact-pane.overlay.copy-content',
              label: t('agent.preview_pane.copy_menu.content'),
              onSelect: onCopyContent
            }
          ]
        : []),
      {
        type: 'item',
        id: 'artifact-pane.overlay.copy-path',
        label: t('agent.preview_pane.copy_menu.absolute_path'),
        onSelect: () => copy(absolutePath)
      },
      ...(relativePath
        ? [
            {
              type: 'item' as const,
              id: 'artifact-pane.overlay.copy-relative-path',
              label: t('agent.preview_pane.copy_menu.relative_path'),
              onSelect: () => copy(relativePath)
            }
          ]
        : []),
      {
        type: 'item',
        id: 'artifact-pane.overlay.copy-file-name',
        label: t('agent.preview_pane.copy_menu.file_name'),
        onSelect: () => copy(fileName)
      },
      {
        type: 'item',
        id: 'artifact-pane.overlay.copy-file',
        label: t(
          copyFile.state === 'ready'
            ? 'agent.preview_pane.copy_menu.file'
            : copyFile.state === 'checking'
              ? 'agent.preview_pane.copy_menu.file_checking'
              : 'agent.preview_pane.copy_menu.file_unavailable'
        ),
        enabled: copyFile.state === 'ready',
        onSelect: copyFile.onSelect
      }
    ]
  }
}

export function canCopyFileContent(
  filePath: string | null,
  isText: string,
  fileSize: { status: string; size?: number }
) {
  if (!filePath || fileSize.status !== 'ok' || typeof fileSize.size !== 'number') return false
  const extension = getFileExtension(filePath)
  if (COPYABLE_DOCUMENT_EXTENSIONS.has(extension)) return fileSize.size <= DOCUMENT_CONTENT_COPY_MAX_SIZE_BYTES
  if (NON_TEXT_DOCUMENT_EXTENSIONS.has(extension)) return false
  return isText === 'text' && fileSize.size <= ARTIFACT_PREVIEW_MAX_SIZE_BYTES
}

export function useArtifactPaneMenus({
  workspacePath,
  onAttachPathToContext
}: {
  workspacePath?: string
  onAttachPathToContext?: (path: string, kind: 'file' | 'directory', name?: string) => void
}) {
  const { t } = useTranslation()
  const copyPath = useCallback(
    async (path: string) => {
      try {
        await navigator.clipboard.writeText(path)
        toast.success(t('message.copy.success'))
      } catch (error) {
        logger.error('Failed to copy path', error as Error)
        toast.error(t('message.copy.failed'))
      }
    },
    [t]
  )

  const copyFile = useCallback(
    async (path: string) => {
      try {
        await ipcApi.request('file.copy_to_clipboard', createFilePathHandle(AbsoluteFilePathSchema.parse(path)))
        toast.success(t('message.copy.success'))
      } catch (error) {
        logger.error('Failed to copy file', error as Error)
        toast.error(t('message.copy.failed'))
      }
    },
    [t]
  )

  const attachMenuItems = useCallback(
    (path: string, kind: 'file' | 'directory', name?: string): CommandContextMenuExtraItem[] =>
      onAttachPathToContext
        ? [
            {
              type: 'item',
              id: 'artifact-pane.file.attach',
              label: t('agent.preview_pane.attach_as_context'),
              icon: <AtSign size={14} />,
              onSelect: () => onAttachPathToContext(path, kind, name)
            }
          ]
        : [],
    [onAttachPathToContext, t]
  )

  const buildFileMenuItems = useCallback(
    (
      selection: ArtifactPaneFileSelection,
      openItems: readonly CommandContextMenuExtraItem[],
      copyState: CopyFileState,
      onCopyContent?: () => void
    ): CommandContextMenuExtraItem[] => {
      const absolutePath = getArtifactPaneSelectionDisplayPath(selection)
      const relativePath = getArtifactPaneSelectionRelativePath(workspacePath, selection)
      return [
        // Attach the file the preview reads; an attachment's original path may no longer exist.
        ...attachMenuItems(getArtifactPaneSelectionPath(selection), 'file', getPreviewFileTitle(selection)),
        buildCopyMenu({
          t,
          copy: (text) => void copyPath(text),
          onCopyContent,
          absolutePath: getCopyableAbsolutePath(absolutePath, isWin),
          relativePath,
          fileName: getPreviewFileTitle(selection),
          copyFile: { state: copyState, onSelect: () => void copyFile(getArtifactPaneSelectionPath(selection)) }
        }),
        ...(openItems.length ? [{ type: 'separator' as const }, ...openItems] : [])
      ]
    },
    [attachMenuItems, copyFile, copyPath, t, workspacePath]
  )

  const copyFileContent = useCallback(
    async (path: string) => {
      try {
        const content = COPYABLE_DOCUMENT_EXTENSIONS.has(getFileExtension(path))
          ? await window.api.file.readExternal(path, true)
          : await window.api.fs.readText(path)
        await navigator.clipboard.writeText(content)
        toast.success(t('message.copy.success'))
      } catch (error) {
        logger.error('Failed to copy file content', { error })
        toast.error(t('message.copy.failed'))
      }
    },
    [t]
  )
  const getTabMenuItems = async ({
    selection,
    active
  }: {
    selection: ArtifactPaneFileSelection
    active: boolean
  }): Promise<readonly CommandContextMenuExtraItem[]> => {
    const path = getArtifactPaneSelectionPath(selection)
    const [openItems, copyState, metadata] = await Promise.all([
      loadOpenTargetMenuItems({ targetPath: path, pathKind: 'file', t }),
      getCopyFileState(path),
      active ? ipcApi.request('file.get_metadata', createFilePathHandle(path)).catch(() => null) : null
    ])
    const copyContent =
      metadata &&
      canCopyFileContent(path, metadata.kind === 'file' ? metadata.type : 'binary', {
        status: 'ok',
        size: metadata.size
      })
        ? () => void copyFileContent(path)
        : undefined
    return buildFileMenuItems(selection, openItems, copyState, copyContent)
  }

  return { buildFileMenuItems, getTabMenuItems, copyPath, copyFile, copyFileContent, attachMenuItems }
}
