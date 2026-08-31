import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { defineTool, type ToolRenderContext, TopicType } from '@renderer/components/composer/tools/types'
import type { QuickPanelFooterAction, QuickPanelListItem } from '@renderer/components/QuickPanel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { useDirectoryTree } from '@renderer/hooks/useDirectoryTree'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { projectNotesTree, resolveNotesPath } from '@renderer/services/NotesService'
import { flattenTreeToFiles } from '@renderer/services/NotesTreeService'
import { FILE_TYPE } from '@renderer/types/file'
import type { NotesTreeNode } from '@renderer/types/note'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { createComposerFileTokenSourceId } from '@renderer/utils/message/composerFileTokenSource'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { NotebookPen, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

export const NOTE_REFERENCE_LAUNCHER_ID = 'note-reference'

const NOTES_TREE_OPTIONS = {
  extensions: ['.md'],
  respectGitignore: false,
  includeHidden: false
}

type NoteReferenceToolContext = ToolRenderContext<readonly ['files'], readonly ['setFiles']>

export function noteToComposerAttachment(note: NotesTreeNode): ComposerAttachment {
  const fileName = note.externalPath.split(/[\\/]/).at(-1) || `${note.name}.md`

  return {
    fileTokenSourceId: createComposerFileTokenSourceId(),
    path: AbsoluteFilePathSchema.parse(note.externalPath),
    name: fileName,
    origin_name: fileName,
    ext: '.md',
    size: 0,
    type: FILE_TYPE.TEXT
  }
}

export const NoteReferenceComposerRuntime = ({ context }: { context: NoteReferenceToolContext }) => {
  const { actions, launcher, state, t } = context
  const { isVisible, symbol, updateList } = useQuickPanel()
  const [dataRequested, setDataRequested] = useState(false)
  const [resolvedNotesPath, setResolvedNotesPath] = useState<string>()
  const [pathError, setPathError] = useState<Error | null>(null)
  const { notesPath } = useNotesSettings()
  const { root, isLoading, error, version } = useDirectoryTree(
    dataRequested ? resolvedNotesPath : undefined,
    NOTES_TREE_OPTIONS
  )
  const selectedFilePaths = useMemo<Set<string | undefined>>(
    () => new Set(state.files.map((file) => file.path)),
    [state.files]
  )

  const noteFiles = useMemo(() => {
    // The directory mirror mutates root in place; reading version keeps this projection synced.
    void version
    if (!root || !resolvedNotesPath) return []
    return flattenTreeToFiles(projectNotesTree(root, resolvedNotesPath))
  }, [resolvedNotesPath, root, version])
  const manageNotesAction = useMemo<QuickPanelFooterAction>(() => {
    const label = t('chat.input.note_reference.manage')
    return {
      id: 'note-reference:manage',
      label,
      ariaLabel: label,
      tooltip: label,
      icon: <Settings2 />,
      action: () => openRoute('/app/notes')
    }
  }, [t])

  const panelItems = useMemo<QuickPanelListItem[]>(() => {
    if (!dataRequested || (!resolvedNotesPath && !pathError) || isLoading) {
      return [
        {
          id: 'note-reference:loading',
          label: t('chat.input.note_reference.loading'),
          icon: <NotebookPen />,
          disabled: true
        }
      ]
    }

    if (pathError || error) {
      return [
        {
          id: 'note-reference:error',
          label: t('chat.input.note_reference.load_failed'),
          icon: <NotebookPen />,
          disabled: true
        }
      ]
    }

    if (noteFiles.length === 0) {
      return [
        {
          id: 'note-reference:empty',
          label: t('chat.input.note_reference.empty'),
          icon: <NotebookPen />,
          disabled: true
        }
      ]
    }

    return noteFiles.map((note) => {
      const isSelected = selectedFilePaths.has(note.externalPath)

      return {
        id: `note-reference:${note.externalPath}`,
        label: note.name,
        description: note.treePath,
        filterText: `${note.name} ${note.treePath}`,
        icon: <NotebookPen />,
        isSelected,
        disabled: isSelected,
        action: () => {
          actions.setFiles?.((files) => {
            if (files.some((file) => file.path === note.externalPath)) return files
            return [...files, noteToComposerAttachment(note)]
          })
        }
      }
    })
  }, [actions, dataRequested, error, isLoading, noteFiles, pathError, resolvedNotesPath, selectedFilePaths, t])

  useEffect(() => {
    if (isVisible && symbol === ComposerPanelSymbol.Notes) {
      updateList(panelItems)
    }
  }, [isVisible, panelItems, symbol, updateList])

  const openNoteReferencePanel = useCallback<NonNullable<ComposerToolLauncher['action']>>(
    ({ parentPanel, queryAnchor, quickPanel }) => {
      setDataRequested(true)
      setResolvedNotesPath(undefined)
      setPathError(null)

      void resolveNotesPath(notesPath)
        .then(({ path }) => setResolvedNotesPath(path))
        .catch((error) => setPathError(error instanceof Error ? error : new Error(String(error))))

      quickPanel.open({
        footerActions: [manageNotesAction],
        title: t('chat.input.note_reference.title'),
        list: panelItems,
        symbol: ComposerPanelSymbol.Notes,
        parentPanel,
        queryAnchor,
        triggerInfo: { type: 'button' },
        trackInputQuery: true
      })
    },
    [manageNotesAction, notesPath, panelItems, t]
  )

  useEffect(() => {
    return launcher.registerLaunchers([
      {
        id: NOTE_REFERENCE_LAUNCHER_ID,
        kind: 'panel',
        sources: ['root-panel'],
        order: 60,
        label: t('chat.input.note_reference.title'),
        description: t('chat.input.note_reference.description'),
        icon: <NotebookPen />,
        panelSymbol: ComposerPanelSymbol.Notes,
        action: openNoteReferencePanel
      }
    ])
  }, [launcher, openNoteReferencePanel, t])

  return null
}

const noteReferenceTool = defineTool({
  key: NOTE_REFERENCE_LAUNCHER_ID,
  label: (t) => t('chat.input.note_reference.title'),
  visibleInScopes: [TopicType.Chat, TopicType.Session],
  dependencies: {
    state: ['files'] as const,
    actions: ['setFiles'] as const
  },
  composer: {
    runtime: ({ context }) => <NoteReferenceComposerRuntime context={context} />
  }
})

export default noteReferenceTool
