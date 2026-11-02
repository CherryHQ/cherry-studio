import type { FileContents, FileOptions, LineAnnotation, SelectedLineRange } from '@pierre/diffs'
import { Virtualizer } from '@pierre/diffs'
import type * as PierreEdit from '@pierre/diffs/edit'
import type { EditorFactory, EditorOptions } from '@pierre/diffs/edit'
import { EditProvider, File, useWorkerPool, VirtualizerContext, WorkerPoolContextProvider } from '@pierre/diffs/react'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CHERRY_CODE_THEME } from '@cherrystudio/ui/code-highlight'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import FileCommentBox from '@renderer/components/FileCommentBox'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import { CHERRY_EDITOR_CSS } from '@renderer/utils/pierreCodeTheme'
import { hasUnwrappableLine } from '@renderer/utils/softWrap'
import { cn } from '@renderer/utils/style'

const logger = loggerService.withContext('FileEditor')
const poolOptions = {
  workerFactory: () => new Worker(new URL('../workers/fileEditor.worker.ts', import.meta.url), { type: 'module' }),
  poolSize: 1,
  onWorkerError: (event: Event) => {
    event.preventDefault()
    logger.error('File highlighting worker failed', event)
  }
}
const highlighterOptions = { preferredHighlighter: 'highlights', useTokenTransformer: true } as const

// Pierre (patched) tags whitespace-only token spans with data-ws and leading ones with data-indent.
const INDENT_GUIDE = 'linear-gradient(to right, var(--border) 0 1px, transparent 1px)'
const WHITESPACE_DOT =
  'radial-gradient(circle, color-mix(in oklch, var(--muted-foreground) 55%, transparent) 1px, transparent 1.5px)'
const WHITESPACE_TAB =
  'linear-gradient(to bottom, transparent calc(50% - 0.5px), color-mix(in oklch, var(--muted-foreground) 55%, transparent) calc(50% - 0.5px) calc(50% + 0.5px), transparent calc(50% + 0.5px))'

// A neutral chip centred between line number and code, not Pierre's filled block that spills into the code
// (and draws "+" in the background colour the Cherry theme makes transparent).
const COMMENT_BUTTON_CSS =
  '[data-utility-button]{background-color:color-mix(in oklch,var(--foreground) 10%,transparent);color:var(--foreground);width:14px;height:calc(1lh - 4px);margin-block:2px;margin-right:-8px;border-radius:4px}' +
  '[data-utility-button]:hover{background-color:color-mix(in oklch,var(--foreground) 20%,transparent)}' +
  '[data-utility-button] [data-icon]{width:12px;height:12px}' +
  // Without line numbers, reserve a margin so the button is clear of the code and the pane's resize edge.
  '[data-disable-line-numbers] [data-column-number]{min-width:24px}' +
  '[data-disable-line-numbers] [data-gutter-utility-slot]{left:10px}' +
  '[data-disable-line-numbers] [data-utility-button]{margin-right:0}'

function whitespaceCss(indentGuides: boolean, showWhitespace: boolean): string {
  const guideSize = 'calc(var(--diffs-tab-size, 2) * 1ch) 100%'
  const rules: string[] = []
  if (indentGuides || showWhitespace) {
    // Spans stay inline with no inline padding, so tab stops and caret geometry are untouched;
    // block padding on an inline box only extends its painted background to the full line height.
    rules.push('[data-ws]{background-repeat:repeat-x;padding-block:calc((var(--diffs-line-height) - 1em) / 2)}')
  }
  if (showWhitespace) {
    rules.push(`[data-ws="space"]{background-image:${WHITESPACE_DOT};background-size:1ch 100%}`)
    rules.push(`[data-ws="tab"]{background-image:${WHITESPACE_TAB};background-size:100% 100%}`)
  }
  if (indentGuides) {
    const ws = showWhitespace ? { space: [WHITESPACE_DOT, '1ch 100%'], tab: [WHITESPACE_TAB, '100% 100%'] } : null
    rules.push(`[data-indent]{background-image:${INDENT_GUIDE};background-size:${guideSize}}`)
    if (ws) {
      for (const [kind, [image, size]] of Object.entries(ws)) {
        rules.push(
          `[data-indent][data-ws="${kind}"]{background-image:${INDENT_GUIDE},${image};background-size:${guideSize},${size}}`
        )
      }
    }
  }
  return rules.join('')
}

function FileEditorTheme({ theme }: { theme: string }) {
  const pool = useWorkerPool()
  useEffect(() => {
    void pool?.setRenderOptions({ theme }).catch((error) => logger.error('Failed to update file theme', error))
  }, [pool, theme])
  return null
}

/** A comment written on lines of the file, with those lines as they read when it was submitted. */
export interface LineComment {
  /** One-based and inclusive. */
  startLine: number
  endLine: number
  lines: string
  comment: string
}

interface Props {
  fileName: string
  value: string
  sessionKey?: string
  onChange?: (value: string) => void
  readOnly?: boolean
  wrapLines?: boolean
  expanded?: boolean
  className?: string
  /** Columns per tab stop. */
  tabSize?: number
  /** When false, Tab and Shift+Tab move focus instead of indenting. */
  tabIndent?: boolean
  indentGuides?: boolean
  showWhitespace?: boolean
  /** Leaves room so the last line can scroll to the top. */
  scrollPastEnd?: boolean
  /** Turns on a comment button beside each line number; called when a comment is submitted. */
  onLineComment?: (comment: LineComment) => void
}

export default function FileEditor({
  fileName,
  value,
  sessionKey,
  onChange,
  readOnly = false,
  wrapLines = false,
  expanded = false,
  className,
  tabSize = 2,
  tabIndent = true,
  indentGuides = false,
  showWhitespace = false,
  scrollPastEnd = false,
  onLineComment
}: Props) {
  const { t } = useTranslation()
  const [messageFontSize] = usePreference('chat.message.font_size')
  const [showLineNumbers] = usePreference('chat.code.show_line_numbers')
  const fontSize = messageFontSize - 1
  const { activeCodeTheme: theme, isCodeThemeDark } = useCodeStyle()
  const runtimeOptions = useMemo(() => ({ ...highlighterOptions, theme }), [theme])
  const editable = !readOnly && onChange !== undefined
  const [editorModule, setEditorModule] = useState<typeof PierreEdit>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [virtualizer] = useState(() => new Virtualizer())
  const lastEdit = useRef<string | null>(null)
  const [input, setInput] = useState(() => ({ value, file: { name: fileName, contents: value } as FileContents }))
  const liveContents = useRef(value)
  const [commentDraft, setCommentDraft] = useState<{ start: number; end: number } | null>(null)
  const commentable = onLineComment !== undefined

  if (input.value !== value || input.file.name !== fileName) {
    // Pierre owns the live document; a host draft echo must not replace it.
    const file =
      value === lastEdit.current && input.file.name === fileName ? input.file : { name: fileName, contents: value }
    if (file !== input.file) liveContents.current = file.contents
    setInput({ value, file })
  }

  useEffect(() => {
    if (editorModule) return
    setLoadFailed(false)
    let cancelled = false
    void import('@pierre/diffs/edit').then(
      (loaded) => {
        if (!cancelled) setEditorModule(loaded)
      },
      (error) => {
        logger.error('Failed to load file editing', error)
        if (!cancelled) setLoadFailed(true)
      }
    )
    return () => {
      cancelled = true
    }
  }, [editorModule])

  const createEditor = useMemo<EditorFactory<undefined, undefined> | undefined>(
    () => editorModule && ((type, options, key) => new editorModule.Editor(type, options, key)),
    [editorModule]
  )
  const openCommentDraft = useCallback((range: SelectedLineRange) => {
    setCommentDraft({ start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) })
  }, [])
  // Wrapping a multi-megabyte line (minified bundles, source maps) freezes layout for seconds.
  const canWrap = useMemo(() => !hasUnwrappableLine(value), [value])
  const options = useMemo<FileOptions<undefined, undefined>>(
    () => ({
      disableFileHeader: true,
      preferredHighlighter: 'highlights',
      useTokenTransformer: true,
      theme,
      themeType: isCodeThemeDark ? 'dark' : 'light',
      overflow: wrapLines && canWrap ? 'wrap' : 'scroll',
      disableLineNumbers: !showLineNumbers,
      ...(commentable && { enableGutterUtility: true, onGutterUtilityClick: openCommentDraft }),
      unsafeCSS:
        (theme === CHERRY_CODE_THEME ? CHERRY_EDITOR_CSS : '') +
          whitespaceCss(indentGuides, showWhitespace) +
          (commentable ? COMMENT_BUTTON_CSS : '') || undefined
    }),
    [
      theme,
      isCodeThemeDark,
      showLineNumbers,
      wrapLines,
      canWrap,
      indentGuides,
      showWhitespace,
      commentable,
      openCommentDraft
    ]
  )
  const editorOptions = useMemo<EditorOptions<'file', undefined, undefined>>(
    () => ({
      readOnly: !editable,
      ownsVerticalViewport: true,
      clipboard: {
        readText: (type) => (!type || type === 'text/plain' ? navigator.clipboard.readText() : '')
      }
    }),
    [editable]
  )
  const handleChange = useCallback(
    ({ file, lineAnnotations }: { file: FileContents; lineAnnotations?: LineAnnotation<undefined>[] }) => {
      lastEdit.current = file.contents
      liveContents.current = file.contents
      // Pierre remaps annotations through edits; the open draft box follows its line.
      const end = lineAnnotations?.[0]?.lineNumber
      if (end !== undefined) {
        setCommentDraft((draft) =>
          draft && draft.end !== end ? { start: Math.max(1, draft.start + end - draft.end), end } : draft
        )
      }
      onChange?.(file.contents)
    },
    [onChange]
  )
  // An empty list, not undefined: Pierre keeps its previous annotations when the prop is absent.
  const commentAnnotations = useMemo<LineAnnotation<undefined>[]>(
    () => (commentDraft ? [{ lineNumber: commentDraft.end }] : []),
    [commentDraft]
  )
  const groupRef = useRef<HTMLDivElement>(null)
  const closeCommentDraft = useCallback((reason: 'escape' | 'blur') => {
    setCommentDraft(null)
    if (reason !== 'escape') return
    // Escape returns to the file; clicking away keeps the user's new focus target.
    requestAnimationFrame(() =>
      groupRef.current
        ?.querySelector('diffs-container')
        ?.shadowRoot?.querySelector<HTMLElement>('[data-content]')
        ?.focus()
    )
  }, [])
  const submitComment = useCallback(
    (comment: string) => {
      if (!commentDraft) return
      const lines = liveContents.current.split(/\r?\n/).slice(commentDraft.start - 1, commentDraft.end)
      onLineComment?.({ startLine: commentDraft.start, endLine: commentDraft.end, lines: lines.join('\n'), comment })
      // No refocus: the composer takes focus when it inserts the chip.
      setCommentDraft(null)
    },
    [commentDraft, onLineComment]
  )
  const attachViewport = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) {
        virtualizer.cleanUp()
        return
      }
      let root = node.parentElement
      if (expanded) {
        while (root && !/(auto|scroll|overlay)/.test(getComputedStyle(root).overflowY)) root = root.parentElement
      }
      virtualizer.setup(expanded ? (root ?? document) : node, node)
    },
    [expanded, virtualizer]
  )
  const surface = (
    <div
      ref={attachViewport}
      className={cn('pb-[var(--chat-composer-inset,0px)]', expanded ? 'min-h-full' : 'h-full min-h-0 overflow-auto')}>
      <File
        file={input.file}
        options={options}
        edit={createEditor !== undefined}
        editorOptions={editorOptions}
        editStateKey={sessionKey}
        onEditChange={editable ? handleChange : undefined}
        onEditComplete={() => 'accept'}
        lineAnnotations={commentAnnotations}
        // The gutter click selects lines; clear it so the box sits on the editor's own background.
        selectedLines={commentable ? null : undefined}
        renderAnnotation={
          commentable
            ? () => (
                // Unwrapped rows are as wide as the longest line; size to the visible editor and stay in view.
                <FileCommentBox
                  className="sticky left-2 mx-2 my-1.5 max-w-[min(42rem,calc(100cqw-6rem))]"
                  onSubmit={submitComment}
                  onCancel={closeCommentDraft}
                />
              )
            : undefined
        }
        style={
          {
            '--diffs-font-family': 'var(--code-font-family)',
            '--diffs-font-size': `${fontSize}px`,
            '--diffs-line-height': `${fontSize * 1.6}px`,
            '--diffs-tab-size': tabSize
          } as CSSProperties
        }
      />
      {scrollPastEnd && !expanded ? <div aria-hidden style={{ height: `calc(100% - ${fontSize * 1.6}px)` }} /> : null}
    </div>
  )

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label={fileName}
      className={cn(
        'flex min-h-0 flex-1 flex-col select-text',
        // The comment box sizes itself against the visible editor width.
        commentable && '@container',
        !expanded && 'overflow-hidden',
        className
      )}
      onKeyDownCapture={
        tabIndent
          ? undefined
          : (event) => {
              // Pierre binds Tab to indent and cannot unbind it, so keep the key from reaching the editor.
              if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) event.stopPropagation()
            }
      }>
      {loadFailed ? <p role="alert">{t('file_preview.load_error.description')}</p> : null}
      <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={runtimeOptions}>
        <FileEditorTheme theme={theme} />
        <VirtualizerContext value={virtualizer}>
          {createEditor ? <EditProvider createEditor={createEditor}>{surface}</EditProvider> : surface}
        </VirtualizerContext>
      </WorkerPoolContextProvider>
    </div>
  )
}
