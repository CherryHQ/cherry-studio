import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ComposerPanelSymbol } from '@renderer/components/chat/composer/quickPanel/symbols'
import { useChatLayoutMode } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import type { QuickPanelInputAdapter, QuickPanelInputEvent, QuickPanelListItem } from '@renderer/components/QuickPanel'
import { QuickPanelView, useQuickPanel } from '@renderer/components/QuickPanel'
import { useRichTextEditorKernel } from '@renderer/components/RichEditor/useRichTextEditorKernel'
import SendMessageButton from '@renderer/components/SendMessageButton'
import { LONG_TEXT_PASTE_THRESHOLD } from '@renderer/config/constant'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useTimer } from '@renderer/hooks/useTimer'
import { isPastedTextFileMetadata } from '@renderer/types'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import {
  createComposerRichClipboardContentFromDraft,
  readComposerClipboardFragmentFromDataTransfer,
  readComposerClipboardFragmentFromSessionCache,
  writeComposerClipboardData
} from '@renderer/utils/message/composerClipboard'
import type { SendMessageShortcut } from '@shared/data/preference/preferenceTypes'
import type { ComposerMessageToken } from '@shared/data/types/uiParts'
import type { EditorOptions, JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { EditorContent, type NodeViewProps } from '@tiptap/react'
import { CirclePause, LocateFixed, Maximize2, Minimize2, X } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FileComposerToken } from '../tokens'
import { createComposerDocumentContent, serializeComposerDocument } from './composerDraft'
import { getComposerClipboardPasteOverride, getComposerPlainTextPasteOverride } from './composerPaste'
import { createComposerEditorPreset } from './composerPreset'
import { COMPOSER_TOKEN_NODE_NAME, type ComposerTokenRenderer } from './ComposerTokenNode'
import pasteHandling from './paste/pasteHandling'
import { useFileDragDrop } from './paste/useFileDragDrop'
import { usePasteHandler } from './paste/usePasteHandler'
import {
  createPromptVariableContent,
  createPromptVariableInlineContent,
  getNextPromptVariableIndex,
  getSelectedPromptVariableToken,
  selectPromptVariableToken,
  tokenizePromptVariablesInEditor,
  updateSelectedPromptVariableToken
} from './promptVariables'
import {
  type ComposerRootPanelSelectHandler,
  type ComposerSuggestionSource,
  createComposerSuggestionQuickPanelItem,
  createRootQuickPanelOpenOptions,
  getComposerCursorTextOffset,
  getComposerInputLeafText,
  getComposerInputText,
  getComposerPositionAtTextOffset,
  getComposerSuggestionTriggerContext,
  hasComposerQuickPanelTriggerBoundary,
  ROOT_QUICK_PANEL_ALLOWED_PREFIXES
} from './quickPanel'
import type { ComposerDraftToken, ComposerSerializedDraft, ComposerSerializedToken } from './tokens'
import type { ComposerToolLauncher } from './toolLauncher'

const COMPOSER_INPUT_MAX_LENGTH = 40000
type ComposerTextInputView = Parameters<NonNullable<NonNullable<EditorOptions['editorProps']>['handleTextInput']>>[0]
interface ComposerClipboardCopyView {
  state: {
    selection: {
      empty: boolean
      content: () => {
        content: {
          toJSON: () => unknown
        }
      }
    }
  }
}

export interface ComposerSurfaceActions {
  focus: () => void
  onTextChange: (updater: string | ((prev: string) => string)) => void
  toggleExpanded: (nextState?: boolean) => void
  removeToken: (tokenId: string) => void
  insertToken: (token: ComposerDraftToken) => void
  getDraft: () => ComposerSerializedDraft
}

export interface ComposerSurfaceEditingState {
  messageId: string
  highlightKey?: number
  onCancel: () => void
  onLocate?: () => void
}

export interface ComposerSurfaceProps {
  text: string
  onTextChange: (text: string) => void
  tokens: readonly ComposerDraftToken[]
  draftTokens?: readonly ComposerSerializedToken[]
  managedTokenKinds: readonly ComposerDraftToken['kind'][]
  onTokensChange: (tokens: readonly ComposerSerializedToken[]) => void
  placeholder: string
  sendDisabled: boolean
  sendBlockedReason?: string
  isLoading: boolean
  onSendDraft: (draft: ComposerSerializedDraft) => void | Promise<void>
  onPause: () => void | Promise<void>
  supportedExts: string[]
  setFiles: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>
  filesCount: number
  isExpanded: boolean
  onExpandedChange: (expanded: boolean) => void
  quickPanelEnabled: boolean
  enableDragDrop: boolean
  enableSpellCheck: boolean
  editable?: boolean
  fontSize: number
  narrowMode: boolean
  onFocus?: () => void
  onActionsChange?: (actions: ComposerSurfaceActions) => void
  editingState?: ComposerSurfaceEditingState
  getToolLaunchers?: () => ComposerToolLauncher[]
  resolveSkillMarker?: (marker: string) => ComposerDraftToken | null | undefined
  resolveKnowledgeBaseMarker?: (marker: string) => ComposerDraftToken | null | undefined
  suggestionSources?: readonly ComposerSuggestionSource[]
  queueContent?: React.ReactNode
  rootPanelAdditionalItems?: readonly QuickPanelListItem[]
  onRootPanelOpen?: () => void
  onToolLauncherSelect?: ComposerRootPanelSelectHandler
  renderLeftControls?: (inputAdapter?: QuickPanelInputAdapter) => React.ReactNode
  renderBelowControls?: (inputAdapter?: QuickPanelInputAdapter) => React.ReactNode
  sendAccessory?: React.ReactNode
}

function removeComposerTokens(editor: Editor, shouldRemove: (token: ComposerSerializedToken) => boolean) {
  const ranges: Array<{ from: number; to: number }> = []

  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== COMPOSER_TOKEN_NODE_NAME) return
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: COMPOSER_TOKEN_NODE_NAME, attrs: node.attrs }] }]
    })
    const token = draft.tokens[0]
    if (token && shouldRemove(token)) {
      ranges.push({ from: position, to: position + node.nodeSize })
    }
  })

  if (!ranges.length) return

  const transaction = editor.state.tr
  for (const range of ranges.reverse()) {
    transaction.delete(range.from, range.to)
  }
  editor.view.dispatch(transaction)
}

function addMissingToken(
  editor: Editor,
  token: ComposerDraftToken,
  existingTokens: readonly ComposerSerializedToken[]
) {
  if (existingTokens.some((existing) => existing.id === token.id)) return
  insertComposerTokenAtCursor(editor, token)
}

function hasComposerTokenBeforeSelection(editor: Editor) {
  const selection = editor.state.selection
  const selectedNode = (selection as { node?: { type?: { name?: string } } }).node
  if (selectedNode?.type?.name === COMPOSER_TOKEN_NODE_NAME) return true
  if (!selection.empty) return false

  return selection.$from.nodeBefore?.type.name === COMPOSER_TOKEN_NODE_NAME
}

function insertComposerTokenAtCursor(
  editor: Editor,
  token: ComposerDraftToken,
  options: { insertSeparator?: boolean } = {}
) {
  const chain = editor.chain().focus().insertComposerToken(token)
  if (options.insertSeparator === false) {
    chain.run()
    return
  }

  chain.insertContent(' ').run()
}

function isComposerSendKeyPressed(event: KeyboardEvent, shortcut: SendMessageShortcut) {
  switch (shortcut) {
    case 'Enter':
      return !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
    case 'Ctrl+Enter':
      return event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey
    case 'Command+Enter':
      return event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey
    case 'Alt+Enter':
      return event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey
    case 'Shift+Enter':
      return event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
  }
}

function deleteComposerTextRange(editor: Editor, range: { from: number; to: number }) {
  const fromOffset = Math.max(0, Math.min(range.from, range.to))
  const toOffset = Math.max(fromOffset, range.to)
  if (fromOffset === toOffset) return

  const from = getComposerPositionAtTextOffset(editor, fromOffset)
  const to = getComposerPositionAtTextOffset(editor, toOffset)
  if (to <= from) return

  editor.chain().focus().deleteRange({ from, to }).run()
}

function createComposerInputAdapter(editor: Editor): QuickPanelInputAdapter {
  return {
    getText: () => getComposerInputText(editor),
    getCursorOffset: () => getComposerCursorTextOffset(editor),
    insertText: (insertedText) => {
      editor
        .chain()
        .focus()
        .insertContent(
          createPromptVariableInlineContent(insertedText, { startIndex: getNextPromptVariableIndex(editor) })
        )
        .run()
    },
    insertToken: (token) => {
      insertComposerTokenAtCursor(editor, token as ComposerDraftToken)
    },
    deleteTriggerRange: (range) => {
      deleteComposerTextRange(editor, range)
    },
    focus: () => {
      editor.commands.focus()
    }
  }
}

const getTokenIds = (tokens: readonly ComposerDraftToken[]) => new Set(tokens.map((token) => token.id))
const getManagedTokenSignature = (
  tokens: readonly ComposerSerializedToken[],
  managedTokenKindSet: ReadonlySet<ComposerDraftToken['kind']>
) =>
  tokens
    .filter((token) => managedTokenKindSet.has(token.kind))
    .map((token) => `${token.kind}:${token.id}:${token.index}:${token.textOffset}`)
    .join('\n')

function shouldDelegateLongTextPasteToFileHandler(text: string) {
  return Boolean(text && text.length > LONG_TEXT_PASTE_THRESHOLD)
}

function exceedsComposerInputMaxLength(currentText: string, nextText: string, replacedText = '') {
  return currentText.length - replacedText.length + nextText.length > COMPOSER_INPUT_MAX_LENGTH
}

function getComposerInputTextWithinLimit(currentText: string, nextText: string, replacedText = '') {
  const remainingLength = COMPOSER_INPUT_MAX_LENGTH - (currentText.length - replacedText.length)
  if (remainingLength <= 0) return ''
  return nextText.slice(0, remainingLength)
}

function getComposerReplacementText(view: ComposerTextInputView | null, from: number, to: number) {
  if (!view || from >= to) return ''
  return view.state.doc.textBetween(from, to, '\n', getComposerInputLeafText)
}

function getComposerSelectedText(editor: Editor) {
  const { from, to } = editor.state.selection
  if (from >= to) return ''
  return editor.state.doc.textBetween(from, to, '\n', getComposerInputLeafText)
}

function readComposerPayloadObject(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null
}

function readComposerPayloadPath(payload: unknown): string | undefined {
  const payloadObject = readComposerPayloadObject(payload)
  const path = payloadObject?.path
  return typeof path === 'string' ? path : undefined
}

function mergeLiveFileTokenPayload(
  token: ComposerSerializedToken,
  liveTokenById: ReadonlyMap<string, ComposerDraftToken>
): ComposerSerializedToken {
  if (token.kind !== 'file' || readComposerPayloadPath(token.payload)) return token

  const liveToken = liveTokenById.get(token.id)
  if (liveToken?.kind !== 'file') return token

  const livePath = readComposerPayloadPath(liveToken.payload)
  if (!livePath) return token

  return {
    ...token,
    payload: {
      ...readComposerPayloadObject(liveToken.payload),
      ...readComposerPayloadObject(token.payload),
      path: livePath
    }
  }
}

function createComposerDraftFromSelectedContent(view: ComposerClipboardCopyView): ComposerSerializedDraft | null {
  const { selection } = view.state
  if (selection.empty) return null

  const content = selection.content().content.toJSON()
  if (!Array.isArray(content) || content.length === 0) return null

  return serializeComposerDocument({ type: 'doc', content: content as JSONContent[] })
}

function handleComposerCopy(
  view: ComposerClipboardCopyView,
  event: ClipboardEvent,
  liveTokenById: ReadonlyMap<string, ComposerDraftToken>
) {
  if (!event.clipboardData) return false

  const draft = createComposerDraftFromSelectedContent(view)
  const richContent = draft
    ? createComposerRichClipboardContentFromDraft({
        ...draft,
        tokens: draft.tokens.map((token) => mergeLiveFileTokenPayload(token, liveTokenById))
      })
    : null
  if (!richContent) return false

  event.preventDefault()
  event.clipboardData.clearData()
  writeComposerClipboardData(event.clipboardData, richContent)
  return true
}

function mergeComposerClipboardFiles(prev: ComposerAttachment[], files: readonly ComposerAttachment[]) {
  if (!files.length) return prev

  const existing = new Set(prev.map((file) => `${file.fileTokenSourceId}:${file.path}`))
  const next = [...prev]
  let changed = false

  for (const file of files) {
    const key = `${file.fileTokenSourceId}:${file.path}`
    if (existing.has(key)) continue
    existing.add(key)
    next.push(file)
    changed = true
  }

  return changed ? next : prev
}

function isRestorableDraftToken(
  token: ComposerSerializedToken
): token is ComposerSerializedToken & ComposerMessageToken {
  return token.kind !== 'promptVariable'
}

function getRestorableDraftTokens(draftTokens: readonly ComposerSerializedToken[] | undefined): ComposerMessageToken[] {
  return (draftTokens ?? [])
    .filter(isRestorableDraftToken)
    .map(({ id, kind, label, icon, description, index, textOffset, promptText, payload }) => ({
      id,
      kind,
      label,
      ...(icon && { icon }),
      ...(description && { description }),
      index,
      textOffset,
      ...(promptText && { promptText }),
      ...(payload !== undefined && { payload })
    }))
}

function createComposerEditorContent(text: string, draftTokens: readonly ComposerSerializedToken[] | undefined) {
  const restorableTokens = getRestorableDraftTokens(draftTokens)
  if (restorableTokens.length) {
    return createComposerDocumentContent(text, { version: 1, tokens: restorableTokens })
  }

  return createPromptVariableContent(text)
}

const COMPOSER_EDITOR_COLLAPSED_MAX_HEIGHT = 'max(220px, 40vh)'
const COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT = 'max(220px, 50vh)'
const COMPOSER_EDITOR_COLLAPSED_MAX_HEIGHT_CLASS = 'max-h-[max(220px,40vh)]!'
const COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT_CLASS = 'max-h-[max(220px,50vh)]!'
const COMPOSER_EDITOR_HEIGHT_TRANSITION_MS = 260
const COMPOSER_EDITING_BORDER_HIGHLIGHT_MS = 900
const COMPOSER_EDITING_BORDER_HIGHLIGHT_TIMER_KEY = 'composerEditingBorderHighlight'

function getComposerEditorMinHeight(fontSize: number) {
  return Math.ceil(fontSize * 1.4 * 2 + 6)
}

function getViewportRelativeHeightPx(minHeight: number, viewportRatio: number) {
  return Math.max(minHeight, Math.round(window.innerHeight * viewportRatio))
}

function getCollapsedEditorFrameHeightPx(frame: HTMLDivElement, editorMinHeight: number) {
  const editorElement = frame.querySelector('.composer-tiptap') as HTMLElement | null
  const contentHeight = editorElement?.scrollHeight || frame.scrollHeight || editorMinHeight
  const maxCollapsedHeight = getViewportRelativeHeightPx(220, 0.4)

  return Math.max(editorMinHeight, Math.min(contentHeight, maxCollapsedHeight))
}

function getComposerEditorStyle(fontSize: number, isExpanded: boolean) {
  const maxHeight = isExpanded ? COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT : COMPOSER_EDITOR_COLLAPSED_MAX_HEIGHT

  return [
    '--composer-editor-padding: 6px 44px 0 15px',
    `--composer-editor-min-height: ${getComposerEditorMinHeight(fontSize)}px`,
    `--composer-editor-font-size: ${fontSize}px`,
    '--composer-editor-line-height: 1.4',
    `max-height: ${maxHeight}`,
    'overflow-y: auto',
    isExpanded ? 'height: 100%' : undefined
  ]
    .filter(Boolean)
    .join('; ')
}

export default function ComposerSurface({
  text,
  onTextChange,
  tokens,
  draftTokens,
  managedTokenKinds,
  onTokensChange,
  placeholder,
  sendDisabled,
  sendBlockedReason,
  isLoading,
  onSendDraft,
  onPause,
  supportedExts,
  setFiles,
  filesCount,
  isExpanded,
  onExpandedChange,
  quickPanelEnabled,
  enableDragDrop,
  enableSpellCheck,
  editable = true,
  fontSize,
  narrowMode,
  onFocus,
  onActionsChange,
  editingState,
  getToolLaunchers,
  resolveSkillMarker,
  resolveKnowledgeBaseMarker,
  suggestionSources = [],
  queueContent,
  rootPanelAdditionalItems,
  onRootPanelOpen,
  onToolLauncherSelect,
  renderLeftControls,
  renderBelowControls,
  sendAccessory
}: ComposerSurfaceProps) {
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const quickPanelRef = useRef(quickPanel)
  quickPanelRef.current = quickPanel
  const { forceWideLayout } = useChatLayoutMode()
  const { setTimeoutTimer } = useTimer()
  const editorMinHeight = getComposerEditorMinHeight(fontSize)
  const editorFrameRef = useRef<HTMLDivElement | null>(null)
  const editorFrameAnimationRef = useRef<number | null>(null)
  const pendingEditorFrameExpandedRef = useRef<boolean | null>(null)
  const [editorFrameHeight, setEditorFrameHeight] = useState<string | null>(null)
  const [isEditingBorderHighlighted, setEditingBorderHighlighted] = useState(false)
  const editorRef = useRef<Editor | null>(null)
  const textRef = useRef(text)
  const pendingLocalTextEchoRef = useRef<string | null>(null)
  const inputListenersRef = useRef(new Set<(event?: QuickPanelInputEvent) => void>())
  const isSyncingTokensRef = useRef(false)
  const managedTokenSignatureRef = useRef('')
  const tokenByIdRef = useRef(new Map<string, ComposerDraftToken>())
  const sendDisabledRef = useRef(sendDisabled)
  const sendBlockedReasonRef = useRef(sendBlockedReason)
  const onSendDraftRef = useRef(onSendDraft)
  const promptVariableEditRef = useRef<{ tokenId: string; started: boolean } | null>(null)
  const promptVariableCompositionRef = useRef<{ tokenId: string; text: string } | null>(null)
  const promptVariableSkipTextInputRef = useRef<{ tokenId: string; text: string } | null>(null)
  const managedTokenKindSet = useMemo(() => new Set(managedTokenKinds), [managedTokenKinds])
  const editingHighlightKey = editingState?.highlightKey

  useEffect(() => {
    textRef.current = text
  }, [text])

  useEffect(() => {
    sendDisabledRef.current = sendDisabled
  }, [sendDisabled])

  useEffect(() => {
    sendBlockedReasonRef.current = sendBlockedReason
  }, [sendBlockedReason])

  useEffect(() => {
    onSendDraftRef.current = onSendDraft
  }, [onSendDraft])

  useEffect(() => {
    tokenByIdRef.current = new Map(tokens.map((token) => [token.id, token]))
  }, [tokens])

  useEffect(() => {
    if (editingHighlightKey === undefined) {
      setEditingBorderHighlighted(false)
      return
    }

    setEditingBorderHighlighted(true)

    return setTimeoutTimer(
      COMPOSER_EDITING_BORDER_HIGHLIGHT_TIMER_KEY,
      () => setEditingBorderHighlighted(false),
      COMPOSER_EDITING_BORDER_HIGHLIGHT_MS
    )
  }, [editingHighlightKey, setTimeoutTimer])

  const showBlockedSendReason = useCallback(() => {
    if (sendBlockedReasonRef.current) {
      window.toast?.error(sendBlockedReasonRef.current)
    }
  }, [])

  const applyComposerText = useCallback(
    (nextText: string) => {
      const limitedText = nextText.slice(0, COMPOSER_INPUT_MAX_LENGTH)
      const editor = editorRef.current
      const currentText = editor && !editor.isDestroyed ? serializeComposerDocument(editor).text : textRef.current
      // Rebuilding from plain text re-tokenizes only prompt variables, so a same-text update (e.g.
      // pasteHandling re-applying the text after a long paste becomes a file) must skip the rebuild
      // or quote/file/knowledge tokens degrade to their serialized text.
      if (limitedText === currentText) return
      textRef.current = limitedText
      pendingLocalTextEchoRef.current = limitedText
      onTextChange(limitedText)
      editor?.commands.setContent(createPromptVariableContent(limitedText), { emitUpdate: false })
    },
    [onTextChange]
  )

  const setText = useCallback<React.Dispatch<React.SetStateAction<string>>>(
    (value) => {
      const nextText = typeof value === 'function' ? value(textRef.current) : value
      applyComposerText(nextText)
    },
    [applyComposerText]
  )

  const { handlePaste } = usePasteHandler(text, setText, {
    supportedExts,
    setFiles,
    onResize: () => undefined,
    t
  })

  const { handleDragEnter, handleDragLeave, handleDragOver, handleDrop, isDragging } = useFileDragDrop({
    supportedExts,
    setFiles,
    onTextDropped: (droppedText) => {
      const editor = editorRef.current
      if (!editor) return
      editor
        .chain()
        .focus()
        .insertContent(
          createPromptVariableInlineContent(droppedText, { startIndex: getNextPromptVariableIndex(editor) })
        )
        .run()
    },
    enabled: enableDragDrop,
    t
  })

  const focusEditor = useCallback(() => {
    editorRef.current?.commands.focus()
  }, [])

  const clearEditorFrameAnimationFrame = useCallback(() => {
    if (editorFrameAnimationRef.current === null) return
    window.cancelAnimationFrame(editorFrameAnimationRef.current)
    editorFrameAnimationRef.current = null
  }, [])

  const handleToggleExpanded = useCallback(
    (nextState?: boolean) => {
      const target = typeof nextState === 'boolean' ? nextState : !isExpanded
      const editorFrame = editorFrameRef.current

      if (editorFrame) {
        clearEditorFrameAnimationFrame()
        setEditorFrameHeight(`${editorFrame.offsetHeight || editorMinHeight}px`)
        pendingEditorFrameExpandedRef.current = target
      }

      onExpandedChange(target)
      focusEditor()
    },
    [clearEditorFrameAnimationFrame, editorMinHeight, focusEditor, isExpanded, onExpandedChange]
  )

  useEffect(() => {
    const editorFrame = editorFrameRef.current
    if (!editorFrame || pendingEditorFrameExpandedRef.current !== isExpanded) return

    const targetHeight = isExpanded
      ? getViewportRelativeHeightPx(220, 0.5)
      : getCollapsedEditorFrameHeightPx(editorFrame, editorMinHeight)

    clearEditorFrameAnimationFrame()
    editorFrameAnimationRef.current = window.requestAnimationFrame(() => {
      setEditorFrameHeight(`${targetHeight}px`)
      editorFrameAnimationRef.current = null
    })

    setTimeoutTimer(
      'composerEditorFrameHeightTransition',
      () => {
        setEditorFrameHeight(null)
        pendingEditorFrameExpandedRef.current = null
      },
      COMPOSER_EDITOR_HEIGHT_TRANSITION_MS + 80
    )
  }, [clearEditorFrameAnimationFrame, editorMinHeight, isExpanded, setTimeoutTimer])

  useEffect(() => clearEditorFrameAnimationFrame, [clearEditorFrameAnimationFrame])

  const handleEditorFrameTransitionEnd = useCallback((event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.propertyName && event.propertyName !== 'height') return

    setEditorFrameHeight(null)
    pendingEditorFrameExpandedRef.current = null
  }, [])

  const handleTextChangeFromTool = useCallback(
    (updater: string | ((prev: string) => string)) => {
      const currentText = editorRef.current ? serializeComposerDocument(editorRef.current).text : textRef.current
      const nextText = typeof updater === 'function' ? updater(currentText) : updater
      applyComposerText(nextText)
    },
    [applyComposerText]
  )

  const removeToken = useCallback((tokenId: string) => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    removeComposerTokens(editor, (token) => token.id === tokenId)
    editor.commands.focus()
  }, [])

  const handleShowPastedTextFileInInput = useCallback(
    async (token: ComposerDraftToken, nodeViewProps: NodeViewProps) => {
      const file = isPastedTextFileMetadata(token.payload) ? token.payload : undefined
      const editor = editorRef.current
      if (!file || !editor || editor.isDestroyed) return

      try {
        const fileText = await window.api.fs.readText(file.path)
        const currentText = serializeComposerDocument(editor).text
        const textToInsert = getComposerInputTextWithinLimit(currentText, fileText)
        const position = typeof nodeViewProps.getPos === 'function' ? nodeViewProps.getPos() : undefined
        const content = textToInsert
          ? createPromptVariableInlineContent(textToInsert, { startIndex: getNextPromptVariableIndex(editor) })
          : []

        if (typeof position === 'number') {
          const chain = editor
            .chain()
            .focus()
            .deleteRange({ from: position, to: position + nodeViewProps.node.nodeSize })
          if (content.length > 0) {
            chain.insertContent(content)
          }
          chain.run()
        } else {
          removeComposerTokens(editor, (candidate) => candidate.id === token.id)
          if (content.length > 0) {
            editor.chain().focus().insertContent(content).run()
          } else {
            editor.commands.focus()
          }
        }

        setFiles((prev) =>
          prev.filter(
            (candidate) => candidate.fileTokenSourceId !== file.fileTokenSourceId || candidate.path !== file.path
          )
        )
      } catch {
        window.toast?.error(t('chat.input.file_error'))
      }
    },
    [setFiles, t]
  )

  const insertToken = useCallback((token: ComposerDraftToken) => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return

    insertComposerTokenAtCursor(editor, token)
  }, [])

  const getDraft = useCallback((): ComposerSerializedDraft => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return { text: textRef.current, tokens: [] }

    return serializeComposerDocument(editor)
  }, [])

  useEffect(() => {
    onActionsChange?.({
      focus: focusEditor,
      onTextChange: handleTextChangeFromTool,
      toggleExpanded: handleToggleExpanded,
      removeToken,
      insertToken,
      getDraft
    })
  }, [focusEditor, getDraft, handleTextChangeFromTool, handleToggleExpanded, insertToken, onActionsChange, removeToken])

  const rootPanelOpenRefreshRequestedRef = useRef(false)
  const rootSuggestionStateRef = useRef({
    getToolLaunchers,
    onRootPanelOpen,
    onToolLauncherSelect,
    quickPanel,
    rootPanelAdditionalItems
  })
  rootSuggestionStateRef.current = {
    getToolLaunchers,
    onRootPanelOpen,
    onToolLauncherSelect,
    quickPanel,
    rootPanelAdditionalItems
  }

  const rootSuggestionSource = useMemo<ComposerSuggestionSource>(
    () => ({
      pluginKey: 'composer-root-suggestion',
      char: ComposerPanelSymbol.Root,
      title: t('settings.quickPanel.title'),
      renderMode: 'headless',
      allowedPrefixes: ROOT_QUICK_PANEL_ALLOWED_PREFIXES,
      items: () => [],
      onActiveChange: ({ editor, query, range, text }) => {
        const { getToolLaunchers, onRootPanelOpen, onToolLauncherSelect, quickPanel, rootPanelAdditionalItems } =
          rootSuggestionStateRef.current
        const launchers = getToolLaunchers?.() ?? []
        const { cursorOffset, queryAnchor, textBeforeTrigger, triggerText } = getComposerSuggestionTriggerContext(
          editor,
          {
            range,
            query,
            text,
            triggerChar: ComposerPanelSymbol.Root
          }
        )

        if (
          !hasComposerQuickPanelTriggerBoundary(textBeforeTrigger) ||
          cursorOffset !== queryAnchor + triggerText.length
        ) {
          if (quickPanel.isVisible && quickPanel.symbol === ComposerPanelSymbol.Root) {
            quickPanel.close('input_prefix_invalid')
          }
          return
        }

        const triggerInfo = {
          type: 'input',
          position: queryAnchor,
          originalText: triggerText
        } as const

        if (!rootPanelOpenRefreshRequestedRef.current) {
          rootPanelOpenRefreshRequestedRef.current = true
          onRootPanelOpen?.()
        }

        quickPanel.open(
          createRootQuickPanelOpenOptions(launchers, {
            onToolLauncherSelect,
            inputAdapter: createComposerInputAdapter(editor),
            quickPanel,
            title: t('settings.quickPanel.title'),
            additionalItems: rootPanelAdditionalItems,
            queryAnchor,
            triggerInfo
          })
        )
      },
      onKeyDown: ({ event }) => {
        return rootSuggestionStateRef.current.quickPanel.dispatchKeyDown(event) ?? false
      },
      onExit: () => {
        rootPanelOpenRefreshRequestedRef.current = false
        window.setTimeout(() => {
          const { quickPanel } = rootSuggestionStateRef.current
          if (quickPanel.isVisible && quickPanel.symbol === ComposerPanelSymbol.Root) {
            quickPanel.close()
          }
        }, 0)
      }
    }),
    [t]
  )

  const suggestionPanelStateRef = useRef({ quickPanel })
  suggestionPanelStateRef.current = { quickPanel }

  const quickPanelSuggestionSources = useMemo<ComposerSuggestionSource[]>(
    () =>
      suggestionSources.map((source) => ({
        ...source,
        renderMode: 'headless',
        onActiveChange: (options) => {
          source.onActiveChange?.(options)

          const { quickPanel } = suggestionPanelStateRef.current
          const { cursorOffset, queryAnchor, textBeforeTrigger, triggerText } = getComposerSuggestionTriggerContext(
            options.editor,
            {
              range: options.range,
              query: options.query,
              text: options.text,
              triggerChar: source.char
            }
          )

          if (
            !hasComposerQuickPanelTriggerBoundary(textBeforeTrigger) ||
            cursorOffset !== queryAnchor + triggerText.length
          ) {
            if (quickPanel.isVisible && quickPanel.symbol === source.char) {
              quickPanel.close('input_prefix_invalid')
            }
            return
          }

          quickPanel.open({
            title: typeof source.title === 'string' ? source.title : undefined,
            list: options.items.map((item) =>
              createComposerSuggestionQuickPanelItem(item, {
                editor: options.editor,
                query: options.query,
                range: options.range
              })
            ),
            symbol: source.char,
            pageSize: source.pageSize,
            multiple: source.multiple,
            queryAnchor,
            triggerInfo: {
              type: 'input',
              position: queryAnchor,
              originalText: triggerText
            },
            trackInputQuery: true,
            manageListExternally: true
          })
        },
        onKeyDown: (props) => {
          const handledByQuickPanel = suggestionPanelStateRef.current.quickPanel.dispatchKeyDown(props.event)
          if (handledByQuickPanel) return true
          return source.onKeyDown?.(props) ?? false
        },
        onExit: (options) => {
          source.onExit?.(options)

          window.setTimeout(() => {
            const { quickPanel } = suggestionPanelStateRef.current
            if (quickPanel.isVisible && quickPanel.symbol === source.char) {
              quickPanel.close()
            }
          }, 0)
        }
      })),
    [suggestionSources]
  )

  const activeSuggestionSources = useMemo(
    () => (quickPanelEnabled ? [rootSuggestionSource, ...quickPanelSuggestionSources] : []),
    [quickPanelEnabled, rootSuggestionSource, quickPanelSuggestionSources]
  )

  const renderComposerToken = useCallback<ComposerTokenRenderer>(
    (token, { selected, nodeViewProps }) => {
      const currentToken = tokenByIdRef.current.get(token.id) ?? token
      if (currentToken.kind !== 'file' || !isPastedTextFileMetadata(currentToken.payload)) return undefined

      const pastedTextToken = currentToken as ComposerDraftToken & { kind: 'file' }
      return (
        <FileComposerToken
          token={pastedTextToken}
          selected={selected}
          tooltipMetadataLayout="split"
          tooltipActions={
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto min-h-0 w-fit justify-start gap-0 border-0 p-0 text-left font-medium text-primary text-xs leading-4 shadow-none hover:text-primary-hover focus-visible:border-0 focus-visible:text-primary-hover focus-visible:underline focus-visible:ring-0 focus-visible:ring-offset-0"
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void handleShowPastedTextFileInInput(pastedTextToken, nodeViewProps)
              }}>
              {t('chat.input.paste_text_file')}
            </Button>
          }
        />
      )
    },
    [handleShowPastedTextFileInInput, t]
  )

  const editorExtensions = useMemo(
    () =>
      createComposerEditorPreset({
        placeholder,
        renderToken: renderComposerToken,
        suggestionSources: activeSuggestionSources
      }),
    [activeSuggestionSources, placeholder, renderComposerToken]
  )

  const editor = useRichTextEditorKernel({
    extensions: editorExtensions,
    content: createComposerEditorContent(text, draftTokens),
    editable,
    enableSpellCheck,
    editorProps: {
      attributes: {
        class: cn(
          'composer-tiptap after:hidden! box-border flex w-full overflow-auto whitespace-pre-wrap break-words rounded-none text-foreground outline-none transition-none! [&::-webkit-scrollbar]:w-[3px]',
          isExpanded ? COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT_CLASS : COMPOSER_EDITOR_COLLAPSED_MAX_HEIGHT_CLASS,
          isExpanded && 'h-full'
        ),
        style: getComposerEditorStyle(fontSize, isExpanded)
      },
      handleKeyDown: (_view, event) => {
        if (
          ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Tab', 'Enter', 'NumpadEnter', 'Escape'].includes(event.key)
        ) {
          const handled = quickPanel.dispatchKeyDown(event)
          if (handled) return true
          if (
            quickPanel.isVisible &&
            event.key === 'Enter' &&
            event.shiftKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            return false
          }
        }

        if (event.key === 'Escape' && isExpanded) {
          event.stopPropagation()
          handleToggleExpanded(false)
          return true
        }

        if (event.key === 'Tab' && !event.isComposing && !quickPanel.isVisible) {
          const targetToken = editorRef.current
            ? selectPromptVariableToken(editorRef.current, event.shiftKey ? -1 : 1)
            : null

          if (targetToken) {
            event.preventDefault()
            event.stopPropagation()
            promptVariableEditRef.current = { tokenId: targetToken.id, started: false }
            return true
          }
        }

        const isEnterPressed = event.key === 'Enter' && !event.isComposing
        if (isEnterPressed && isComposerSendKeyPressed(event, sendMessageShortcut)) {
          if (!sendDisabledRef.current && editorRef.current) {
            const draft = serializeComposerDocument(editorRef.current)
            void Promise.resolve(onSendDraftRef.current(draft)).finally(focusEditor)
          } else {
            showBlockedSendReason()
          }
          event.preventDefault()
          return true
        }

        if (
          event.key === 'Backspace' &&
          textRef.current.trim().length === 0 &&
          filesCount > 0 &&
          (!editorRef.current || !hasComposerTokenBeforeSelection(editorRef.current))
        ) {
          setFiles((prev) => prev.slice(0, -1))
          event.preventDefault()
          return true
        }

        return false
      },
      handleTextInput: (view, from, to, insertedText) => {
        const editor = editorRef.current
        if (!editor || editor.isDestroyed) return false
        const selectedPromptVariable = getSelectedPromptVariableToken(editor)
        if (!selectedPromptVariable) {
          const replacedText = getComposerReplacementText(view, from, to)
          if (!exceedsComposerInputMaxLength(textRef.current, insertedText, replacedText)) return false

          const limitedInsertedText = getComposerInputTextWithinLimit(textRef.current, insertedText, replacedText)
          if (limitedInsertedText && view) {
            view.dispatch(view.state.tr.insertText(limitedInsertedText, from, to))
          }
          return true
        }

        const composingToken = promptVariableCompositionRef.current
        if (editor.view.composing || composingToken?.tokenId === selectedPromptVariable.token.id) {
          if (composingToken) composingToken.text = insertedText || composingToken.text
          return true
        }

        const skippedTextInput = promptVariableSkipTextInputRef.current
        if (skippedTextInput?.tokenId === selectedPromptVariable.token.id && skippedTextInput.text === insertedText) {
          promptVariableSkipTextInputRef.current = null
          return true
        }

        const editState = promptVariableEditRef.current
        const shouldAppend = editState?.tokenId === selectedPromptVariable.token.id && editState.started
        const baseText = shouldAppend ? (selectedPromptVariable.token.promptText ?? '') : ''
        const nextPromptText = `${baseText}${insertedText}`
        const limitedPromptText = getComposerInputTextWithinLimit(
          textRef.current,
          nextPromptText,
          selectedPromptVariable.token.promptText ?? ''
        )
        if (!limitedPromptText) return true
        updateSelectedPromptVariableToken(editor, limitedPromptText)
        promptVariableEditRef.current = { tokenId: selectedPromptVariable.token.id, started: true }
        return true
      },
      handleDOMEvents: {
        copy: (view, event) => handleComposerCopy(view, event, tokenByIdRef.current),
        cut: (view, event) => {
          if (!handleComposerCopy(view, event, tokenByIdRef.current)) return false

          const editor = editorRef.current
          if (editor && !editor.isDestroyed && editor.isEditable) {
            editor.chain().focus().deleteSelection().run()
          }
          return true
        },
        compositionstart: () => {
          const editor = editorRef.current
          if (!editor || editor.isDestroyed) return false
          const selectedPromptVariable = getSelectedPromptVariableToken(editor)
          if (!selectedPromptVariable) return false

          promptVariableCompositionRef.current = { tokenId: selectedPromptVariable.token.id, text: '' }
          promptVariableEditRef.current = { tokenId: selectedPromptVariable.token.id, started: false }
          return false
        },
        compositionupdate: (_view, event) => {
          const editor = editorRef.current
          const composingToken = promptVariableCompositionRef.current
          if (!editor || editor.isDestroyed || !composingToken) return false
          const selectedPromptVariable = getSelectedPromptVariableToken(editor)
          if (selectedPromptVariable?.token.id !== composingToken.tokenId) return false

          const data = 'data' in event && typeof event.data === 'string' ? event.data : ''
          composingToken.text = data || composingToken.text
          return true
        },
        compositionend: (_view, event) => {
          const editor = editorRef.current
          const composingToken = promptVariableCompositionRef.current
          promptVariableCompositionRef.current = null

          if (!editor || editor.isDestroyed || !composingToken) return false
          const selectedPromptVariable = getSelectedPromptVariableToken(editor)
          if (selectedPromptVariable?.token.id !== composingToken.tokenId) return false

          const data = 'data' in event && typeof event.data === 'string' ? event.data : ''
          const nextValue = data || composingToken.text
          if (!nextValue) return true
          const limitedNextValue = getComposerInputTextWithinLimit(
            textRef.current,
            nextValue,
            selectedPromptVariable.token.promptText ?? ''
          )
          if (!limitedNextValue) return true

          updateSelectedPromptVariableToken(editor, limitedNextValue)
          promptVariableEditRef.current = { tokenId: selectedPromptVariable.token.id, started: true }
          promptVariableSkipTextInputRef.current = { tokenId: selectedPromptVariable.token.id, text: limitedNextValue }
          return true
        }
      }
    },
    handlePaste: (_view, event) => {
      const pastedText = event.clipboardData?.getData('text/plain') || event.clipboardData?.getData('text') || ''
      const pastedHtml = event.clipboardData?.getData('text/html') || ''
      const editor = editorRef.current
      const selectedPromptVariable = editor ? getSelectedPromptVariableToken(editor) : null
      if (editor && selectedPromptVariable && pastedText) {
        event.preventDefault()
        const limitedPastedText = getComposerInputTextWithinLimit(
          textRef.current,
          pastedText,
          selectedPromptVariable.token.promptText ?? ''
        )
        if (!limitedPastedText) return true
        updateSelectedPromptVariableToken(editor, limitedPastedText)
        promptVariableEditRef.current = { tokenId: selectedPromptVariable.token.id, started: true }
        return true
      }

      if (shouldDelegateLongTextPasteToFileHandler(pastedText)) {
        event.preventDefault()
        void handlePaste(event)
        return true
      }

      let textToInsert = pastedText
      if (editor && pastedText) {
        const selectedText = getComposerSelectedText(editor)
        textToInsert = getComposerInputTextWithinLimit(textRef.current, pastedText, selectedText)
        if (!textToInsert) {
          event.preventDefault()
          return true
        }
      }

      if (editor && textToInsert === pastedText) {
        const pasteOptions = {
          promptVariableStartIndex: getNextPromptVariableIndex(editor),
          resolveSkillMarker,
          resolveKnowledgeBaseMarker
        }
        const clipboardPasteOverride =
          getComposerClipboardPasteOverride(
            readComposerClipboardFragmentFromDataTransfer(event.clipboardData),
            pasteOptions
          ) ??
          getComposerClipboardPasteOverride(readComposerClipboardFragmentFromSessionCache(pastedText), pasteOptions)

        if (clipboardPasteOverride !== null) {
          event.preventDefault()
          editor.chain().focus().insertContent(clipboardPasteOverride.content).run()
          if (clipboardPasteOverride.files.length > 0) {
            setFiles((prev) => mergeComposerClipboardFiles(prev, clipboardPasteOverride.files))
          }
          return true
        }
      }

      const plainTextOverride = getComposerPlainTextPasteOverride(textToInsert, {
        promptVariableStartIndex: editor ? getNextPromptVariableIndex(editor) : 0,
        resolveSkillMarker,
        resolveKnowledgeBaseMarker
      })

      if (plainTextOverride !== null) {
        event.preventDefault()
        editorRef.current?.chain().focus().insertContent(plainTextOverride).run()
        return true
      }

      if (!pastedText && pastedHtml.includes('data-composer-token')) {
        event.preventDefault()
        return true
      }

      void handlePaste(event)
      return false
    },
    onUpdate: ({ editor: updatedEditor }) => {
      if (tokenizePromptVariablesInEditor(updatedEditor)) return

      const draft = serializeComposerDocument(updatedEditor)
      const nextText = draft.text
      textRef.current = nextText
      pendingLocalTextEchoRef.current = nextText
      onTextChange(nextText)
      const inputEventCause = isSyncingTokensRef.current ? 'state-sync' : 'user-input'
      inputListenersRef.current.forEach((listener) =>
        listener({ isComposing: updatedEditor.view.composing, cause: inputEventCause })
      )

      const nextManagedTokenSignature = getManagedTokenSignature(draft.tokens, managedTokenKindSet)
      if (!isSyncingTokensRef.current) {
        if (nextManagedTokenSignature !== managedTokenSignatureRef.current) {
          managedTokenSignatureRef.current = nextManagedTokenSignature
          onTokensChange(draft.tokens)
        }
      } else {
        managedTokenSignatureRef.current = nextManagedTokenSignature
      }
    },
    onCreate: ({ editor: createdEditor }) => {
      setTimeoutTimer(
        'composerSurfaceFocus',
        () => {
          if (!createdEditor || createdEditor.isDestroyed) return
          createdEditor.commands.focus()
        },
        0
      )
    }
  })

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const currentText = serializeComposerDocument(editor).text
    if (currentText === text) {
      pendingLocalTextEchoRef.current = null
      return
    }
    if (pendingLocalTextEchoRef.current === text) {
      pendingLocalTextEchoRef.current = null
      return
    }
    pendingLocalTextEchoRef.current = null
    editor.commands.setContent(createComposerEditorContent(text, draftTokens), { emitUpdate: false })
  }, [draftTokens, editor, text])

  useEffect(() => {
    if (editingHighlightKey === undefined) return
    focusEditor()
  }, [editingHighlightKey, focusEditor])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const draft = serializeComposerDocument(editor)
    const desiredTokenIds = getTokenIds(tokens)
    isSyncingTokensRef.current = true

    try {
      for (const token of tokens) {
        addMissingToken(editor, token, draft.tokens)
      }

      removeComposerTokens(editor, (token) => managedTokenKindSet.has(token.kind) && !desiredTokenIds.has(token.id))
    } finally {
      isSyncingTokensRef.current = false
    }

    managedTokenSignatureRef.current = getManagedTokenSignature(
      serializeComposerDocument(editor).tokens,
      managedTokenKindSet
    )
  }, [editor, managedTokenKindSet, tokens])

  const inputAdapter = useMemo<QuickPanelInputAdapter | undefined>(() => {
    if (!editor) return undefined

    return {
      getText: () => getComposerInputText(editor),
      getCursorOffset: () => getComposerCursorTextOffset(editor),
      insertText: (insertedText) => {
        editor
          .chain()
          .focus()
          .insertContent(
            createPromptVariableInlineContent(insertedText, { startIndex: getNextPromptVariableIndex(editor) })
          )
          .run()
      },
      insertToken: (token) => {
        insertComposerTokenAtCursor(editor, token as ComposerDraftToken)
      },
      deleteTriggerRange: (range) => {
        deleteComposerTextRange(editor, range)
      },
      focus: () => {
        editor.commands.focus()
      },
      subscribeInput: (listener) => {
        inputListenersRef.current.add(listener)
        return () => {
          inputListenersRef.current.delete(listener)
        }
      }
    }
  }, [editor])

  const isRootQuickPanelVisible =
    quickPanelEnabled && quickPanel.isVisible && quickPanel.symbol === ComposerPanelSymbol.Root
  const rootQuickPanelQueryAnchor = quickPanel.queryAnchor
  const rootQuickPanelTriggerInfo = quickPanel.triggerInfo

  useEffect(() => {
    if (!isRootQuickPanelVisible) return

    const currentQuickPanel = quickPanelRef.current
    const launchers = getToolLaunchers?.() ?? []
    currentQuickPanel.updateList(
      createRootQuickPanelOpenOptions(launchers, {
        onToolLauncherSelect,
        inputAdapter,
        quickPanel: currentQuickPanel,
        title: t('settings.quickPanel.title'),
        additionalItems: rootPanelAdditionalItems,
        queryAnchor: rootQuickPanelQueryAnchor,
        triggerInfo: rootQuickPanelTriggerInfo
      }).list
    )
  }, [
    getToolLaunchers,
    inputAdapter,
    isRootQuickPanelVisible,
    onToolLauncherSelect,
    rootPanelAdditionalItems,
    rootQuickPanelQueryAnchor,
    rootQuickPanelTriggerInfo,
    t
  ])

  useEffect(() => {
    pasteHandling.init()
    pasteHandling.registerHandler('inputbar', handlePaste)
    return () => {
      pasteHandling.unregisterHandler('inputbar')
    }
  }, [handlePaste])

  const sendDraft = useCallback(() => {
    if (!editor) return
    if (sendDisabled) {
      showBlockedSendReason()
      return
    }
    const draft = serializeComposerDocument(editor)
    void Promise.resolve(onSendDraft(draft)).finally(focusEditor)
  }, [editor, focusEditor, onSendDraft, sendDisabled, showBlockedSendReason])

  const quickPanelElement = quickPanelEnabled ? <QuickPanelView inputAdapter={inputAdapter} /> : null
  const showPauseButton = isLoading && sendDisabled
  const belowControls = renderBelowControls?.(inputAdapter)
  const ExpandIcon = isExpanded ? Minimize2 : Maximize2
  const editingModeBadge = editingState ? (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('chat.input.editing_message')}
      data-composer-editing-badge=""
      className="-translate-y-1/2 absolute top-0 left-3 z-4 inline-flex h-6 max-w-[180px] items-center gap-1.5 rounded-full border border-border-subtle bg-card px-2 text-foreground-secondary text-xs">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
      <span className="min-w-0 truncate font-medium">{t('chat.input.editing')}</span>
      {editingState.onLocate ? (
        <Tooltip content={t('chat.input.locate_editing_message')}>
          <Button
            type="button"
            onClick={editingState.onLocate}
            variant="ghost"
            size="icon-sm"
            className="-mr-1 size-5 shrink-0 rounded-full text-foreground-muted hover:bg-accent hover:text-foreground"
            aria-label={t('chat.input.locate_editing_message')}>
            <LocateFixed size={14} />
          </Button>
        </Tooltip>
      ) : null}
      <Tooltip content={t('chat.input.cancel_editing')}>
        <Button
          type="button"
          onClick={editingState.onCancel}
          variant="ghost"
          size="icon-sm"
          className="-mr-1 size-5 shrink-0 rounded-full text-foreground-muted hover:bg-accent hover:text-foreground"
          aria-label={t('chat.input.cancel_editing')}>
          <X size={14} />
        </Button>
      </Tooltip>
    </div>
  ) : null
  const inputbarElement = (
    <div
      id="inputbar"
      data-composer-inputbar=""
      className={cn(
        'inputbar-container relative rounded-[20px] border-[0.5px] border-border bg-card pt-2 shadow-[0_4px_12px_rgba(15,23,42,0.08)] transition-all duration-200 ease-in-out dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)]',
        belowControls ? 'mb-0.5' : 'mb-3',
        isEditingBorderHighlighted && !isDragging && 'border-primary ring-2 ring-primary/20',
        isDragging &&
          "border-2 border-[#2ecc71] border-dashed before:pointer-events-none before:absolute before:inset-0 before:z-5 before:rounded-[18px] before:bg-[rgba(46,204,113,0.03)] before:content-['']",
        isExpanded && 'expanded'
      )}>
      <div data-composer-expand-corner="" className="group/expand-corner absolute top-px right-px z-4 size-7">
        <span
          aria-hidden="true"
          data-composer-expand-corner-line=""
          className={cn(
            'pointer-events-none absolute top-0 right-0 size-[18px] origin-top-right scale-100 rounded-tr-[18px] border-black/70 border-t-[1.5px] border-r-[1.5px] opacity-70 transition-[opacity,scale] duration-200 ease-out group-focus-within/expand-corner:scale-50 group-focus-within/expand-corner:opacity-0 group-hover/expand-corner:scale-50 group-hover/expand-corner:opacity-0 dark:border-white/70',
            isExpanded && 'scale-50 opacity-0'
          )}
        />
        <Button
          type="button"
          onClick={() => handleToggleExpanded()}
          variant="ghost"
          size="icon-sm"
          className={cn(
            '-translate-y-2.5 [&_svg]:!size-3 pointer-events-none absolute top-1 right-1 size-5.5 translate-x-2.5 rotate-[-8deg] scale-80 rounded-full bg-transparent text-foreground-secondary/60 opacity-0 shadow-none transition-[opacity,translate,scale,rotate,color,background-color] duration-300 ease-out hover:bg-accent hover:text-foreground focus-visible:pointer-events-auto focus-visible:translate-x-0 focus-visible:translate-y-0 focus-visible:rotate-0 focus-visible:scale-100 focus-visible:bg-accent focus-visible:text-foreground focus-visible:opacity-100 group-focus-within/expand-corner:pointer-events-auto group-focus-within/expand-corner:translate-x-0 group-focus-within/expand-corner:translate-y-0 group-focus-within/expand-corner:rotate-0 group-focus-within/expand-corner:scale-100 group-focus-within/expand-corner:bg-accent/80 group-focus-within/expand-corner:text-foreground group-focus-within/expand-corner:opacity-100 group-hover/expand-corner:pointer-events-auto group-hover/expand-corner:translate-x-0 group-hover/expand-corner:translate-y-0 group-hover/expand-corner:rotate-0 group-hover/expand-corner:scale-100 group-hover/expand-corner:bg-accent/80 group-hover/expand-corner:text-foreground group-hover/expand-corner:opacity-100',
            isExpanded &&
              'pointer-events-auto translate-x-0 translate-y-0 rotate-0 scale-100 bg-accent/80 text-foreground opacity-100'
          )}
          aria-pressed={isExpanded}
          aria-label={isExpanded ? t('chat.input.collapse') : t('chat.input.expand')}>
          <ExpandIcon className="transition-[scale] duration-300 ease-out group-focus-within/expand-corner:scale-110 group-hover/expand-corner:scale-110" />
        </Button>
      </div>
      {editingModeBadge}
      <div
        ref={editorFrameRef}
        className="overflow-hidden transition-[height] ease-out"
        onTransitionEnd={handleEditorFrameTransitionEnd}
        style={
          {
            height: editorFrameHeight ?? (isExpanded ? COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT : undefined),
            minHeight: editorMinHeight,
            overflow: 'hidden',
            transitionDuration: `${COMPOSER_EDITOR_HEIGHT_TRANSITION_MS}ms`
          } as React.CSSProperties
        }>
        <EditorContent
          editor={editor}
          style={isExpanded ? { height: '100%', minHeight: editorMinHeight } : { minHeight: editorMinHeight }}
          onFocus={() => {
            onFocus?.()
            pasteHandling.setLastFocusedComponent('inputbar')
          }}
        />
      </div>

      <div
        data-composer-toolbar=""
        className="relative z-2 flex h-10 shrink-0 flex-row justify-between gap-4 px-2 py-1.25">
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">{renderLeftControls?.(inputAdapter)}</div>
        <div className="flex flex-row items-center gap-1.5">
          {sendAccessory}
          {showPauseButton ? (
            <Tooltip content={t('chat.input.pause')} placement="top">
              <button
                type="button"
                className="flex size-7.5 items-center justify-center rounded-full text-error-base hover:bg-accent"
                aria-label={t('chat.input.pause')}
                onClick={() => void onPause()}>
                <CirclePause size={20} />
              </button>
            </Tooltip>
          ) : (
            <SendMessageButton
              sendMessage={sendDraft}
              disabled={sendDisabled}
              onDisabledClick={showBlockedSendReason}
            />
          )}
        </div>
      </div>
    </div>
  )
  const inputbarStack = (
    <div className="relative">
      {quickPanelElement}
      {inputbarElement}
    </div>
  )

  return (
    <NarrowLayout narrowMode={narrowMode && !forceWideLayout} withSidePadding style={{ width: '100%' }}>
      <div className="w-full">
        <div
          className="inputbar relative z-2 flex flex-col pt-0"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}>
          {belowControls ? (
            <div className="mb-6 rounded-[20px] bg-muted/25 pb-1.5 shadow-[0_14px_36px_rgba(15,23,42,0.07)] dark:bg-muted/15 dark:shadow-[0_14px_36px_rgba(0,0,0,0.24)]">
              {queueContent}
              {inputbarStack}
              <div className="min-w-0 overflow-hidden px-2 pt-0.5">{belowControls}</div>
            </div>
          ) : (
            <>
              {queueContent}
              {inputbarStack}
            </>
          )}
        </div>
      </div>
    </NarrowLayout>
  )
}
