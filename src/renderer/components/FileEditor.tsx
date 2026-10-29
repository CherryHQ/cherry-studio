import type { FileContents, FileOptions } from '@pierre/diffs'
import { Virtualizer } from '@pierre/diffs'
import type * as PierreEdit from '@pierre/diffs/edit'
import type { EditorFactory, EditorOptions } from '@pierre/diffs/edit'
import { EditProvider, File, useWorkerPool, VirtualizerContext, WorkerPoolContextProvider } from '@pierre/diffs/react'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CHERRY_CODE_THEME } from '@cherrystudio/ui/code-highlight'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import { CHERRY_EDITOR_CSS } from '@renderer/utils/pierreCodeTheme'
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

function FileEditorTheme({ theme }: { theme: string }) {
  const pool = useWorkerPool()
  useEffect(() => {
    void pool?.setRenderOptions({ theme }).catch((error) => logger.error('Failed to update file theme', error))
  }, [pool, theme])
  return null
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
}

export default function FileEditor({
  fileName,
  value,
  sessionKey,
  onChange,
  readOnly = false,
  wrapLines = false,
  expanded = false,
  className
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

  if (input.value !== value || input.file.name !== fileName) {
    // Pierre owns the live document; a host draft echo must not replace it.
    const file =
      value === lastEdit.current && input.file.name === fileName ? input.file : { name: fileName, contents: value }
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
  const options = useMemo<FileOptions<undefined, undefined>>(
    () => ({
      disableFileHeader: true,
      preferredHighlighter: 'highlights',
      useTokenTransformer: true,
      theme,
      themeType: isCodeThemeDark ? 'dark' : 'light',
      overflow: wrapLines ? 'wrap' : 'scroll',
      disableLineNumbers: !showLineNumbers,
      unsafeCSS: theme === CHERRY_CODE_THEME ? CHERRY_EDITOR_CSS : undefined
    }),
    [theme, isCodeThemeDark, showLineNumbers, wrapLines]
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
    ({ file }: { file: FileContents }) => {
      lastEdit.current = file.contents
      onChange?.(file.contents)
    },
    [onChange]
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
        style={
          {
            '--diffs-font-family': 'var(--code-font-family)',
            '--diffs-font-size': `${fontSize}px`,
            '--diffs-line-height': `${fontSize * 1.6}px`
          } as CSSProperties
        }
      />
    </div>
  )

  return (
    <div
      role="group"
      aria-label={fileName}
      className={cn('flex min-h-0 flex-1 flex-col select-text', !expanded && 'overflow-hidden', className)}>
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
