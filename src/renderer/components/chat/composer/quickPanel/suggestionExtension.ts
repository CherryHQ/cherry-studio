import { loggerService } from '@logger'
import type { Editor, Range } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { t } from 'i18next'
import type { ReactNode } from 'react'

const logger = loggerService.withContext('ComposerSuggestionExtension')

export interface ComposerSuggestionItem {
  id: string
  label: ReactNode | string
  description?: ReactNode | string
  icon?: ReactNode | string
  filterText?: string
  selected?: boolean
  disabled?: boolean
  isMenu?: boolean
  suffix?: ReactNode | string
  query?: string
  command: (options: { editor: Editor; range: Range; item: ComposerSuggestionItem; query: string }) => void
}

export interface ComposerSuggestionSource {
  pluginKey: string
  char: string
  allowSpaces?: boolean
  allowedPrefixes?: string[] | null
  startOfLine?: boolean
  renderMode?: 'headless'
  multiple?: boolean
  pageSize?: number
  title?: ReactNode | string
  onActiveChange?: (options: ComposerSuggestionActiveChangeOptions) => void
  onExit?: (options: ComposerSuggestionActiveChangeOptions) => void
  onKeyDown?: (props: SuggestionKeyDownProps) => boolean
  items: (options: { query: string; editor: Editor }) => ComposerSuggestionItem[] | Promise<ComposerSuggestionItem[]>
}

export interface ComposerSuggestionActiveChangeOptions {
  editor: Editor
  range: Range
  query: string
  text: string
  items: ComposerSuggestionItem[]
}

function createActiveChangeOptions(
  props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>
): ComposerSuggestionActiveChangeOptions {
  return {
    editor: props.editor,
    range: props.range,
    query: props.query,
    text: props.text,
    items: props.items
  }
}

function createSuggestionRender(source: ComposerSuggestionSource) {
  const notifyActiveChange = (props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>) => {
    source.onActiveChange?.(createActiveChangeOptions(props))
  }

  return {
    onStart: notifyActiveChange,
    onUpdate: notifyActiveChange,
    onExit: (props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>) => {
      source.onExit?.(createActiveChangeOptions(props))
    },
    onKeyDown: (props: SuggestionKeyDownProps) => source.onKeyDown?.(props) ?? false
  }
}

function hasTriggerBoundary(editor: Editor, range: Range) {
  if (range.from <= 1) return true
  const before = editor.state.doc.textBetween(Math.max(0, range.from - 1), range.from, '\n', '')
  return before.length === 0 || /\s/.test(before)
}

export function createComposerSuggestionExtension(sources: readonly ComposerSuggestionSource[]) {
  return Extension.create({
    name: 'composerSuggestion',

    addProseMirrorPlugins() {
      return sources.map((source) => {
        return Suggestion<ComposerSuggestionItem, ComposerSuggestionItem>({
          editor: this.editor,
          pluginKey: new PluginKey(source.pluginKey),
          char: source.char,
          allowSpaces: source.allowSpaces,
          allowedPrefixes: source.allowedPrefixes,
          startOfLine: source.startOfLine,
          allow: ({ editor, range }) => hasTriggerBoundary(editor, range),
          items: async ({ editor, query }) => {
            try {
              const items = await source.items({ editor, query })
              return items.map((item) => ({ ...item, query }))
            } catch (error) {
              logger.warn('Failed to load composer suggestion items', { error, pluginKey: source.pluginKey })
              return [
                {
                  id: `${source.pluginKey}:error`,
                  label: t('common.error'),
                  description: error instanceof Error ? error.message : String(error),
                  disabled: true,
                  command: () => undefined
                }
              ]
            }
          },
          command: ({ editor, range, props }) => {
            if (props.disabled) return
            editor.chain().focus().deleteRange(range).run()
            props.command({ editor, range, item: props, query: props.query ?? '' })
          },
          render: () => createSuggestionRender(source)
        })
      })
    }
  })
}
