import type { Editor, Range } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { t } from 'i18next'
import type { ReactNode } from 'react'

import { loggerService } from '@logger'

const logger = loggerService.withContext('ComposerSuggestionExtension')
const suggestionItemsGeneration = new WeakMap<readonly ComposerSuggestionItem[], number>()

export const COMPOSER_SUPPRESS_SUGGESTION_META = 'composerSuppressSuggestion'

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
  searchAliases?: readonly string[]
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

interface ComposerSuggestionPluginState {
  active: boolean
  range: Range
  query: string | null
  text: string | null
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

function isCurrentActiveSuggestion(
  props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>,
  pluginKey: PluginKey<ComposerSuggestionPluginState>
) {
  const current = pluginKey.getState(props.editor.state)

  return (
    current?.active === true &&
    current.query === props.query &&
    current.text === props.text &&
    current.range.from === props.range.from &&
    current.range.to === props.range.to
  )
}

function createSuggestionRender(
  source: ComposerSuggestionSource,
  pluginKey: PluginKey<ComposerSuggestionPluginState>,
  getLatestItemsGeneration: () => number
) {
  let lastNotifiedItemsGeneration = 0

  const notifyActiveChange = (props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>) => {
    if (props.editor.isDestroyed) return
    const itemsGeneration = suggestionItemsGeneration.get(props.items)
    if (itemsGeneration !== getLatestItemsGeneration() || itemsGeneration === lastNotifiedItemsGeneration) return
    if (!isCurrentActiveSuggestion(props, pluginKey)) return
    lastNotifiedItemsGeneration = itemsGeneration
    source.onActiveChange?.(createActiveChangeOptions(props))
  }

  return {
    onStart: notifyActiveChange,
    onUpdate: notifyActiveChange,
    onExit: (props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>) => {
      const current = pluginKey.getState(props.editor.state)
      if (current?.active && !isCurrentActiveSuggestion(props, pluginKey)) return
      source.onExit?.(createActiveChangeOptions(props))
    },
    onKeyDown: (props: SuggestionKeyDownProps) => source.onKeyDown?.(props) ?? false
  }
}

function hasTriggerBoundary(editor: Editor, range: Range) {
  const from = Math.max(0, Math.min(range.from, editor.state.doc.content.size))
  if (from <= 1) return true
  const before = editor.state.doc.textBetween(Math.max(0, from - 1), from, '\n', '')
  return before.length === 0 || /\s/.test(before)
}

export function createComposerSuggestionExtension(sources: readonly ComposerSuggestionSource[]) {
  return Extension.create({
    name: 'composerSuggestion',

    addProseMirrorPlugins() {
      return sources.map((source) => {
        const pluginKey = new PluginKey<ComposerSuggestionPluginState>(source.pluginKey)
        let latestItemsGeneration = 0

        const recordItemsGeneration = (items: ComposerSuggestionItem[], generation: number) => {
          suggestionItemsGeneration.set(items, generation)
          return items
        }

        return Suggestion<ComposerSuggestionItem, ComposerSuggestionItem>({
          editor: this.editor,
          pluginKey,
          char: source.char,
          allowSpaces: source.allowSpaces,
          allowedPrefixes: source.allowedPrefixes,
          startOfLine: source.startOfLine,
          allow: ({ editor, range }) => hasTriggerBoundary(editor, range),
          shouldShow: ({ transaction }) => !transaction.getMeta(COMPOSER_SUPPRESS_SUGGESTION_META),
          items: async ({ editor, query }) => {
            const itemsGeneration = ++latestItemsGeneration

            try {
              const items = await source.items({ editor, query })
              return recordItemsGeneration(
                items.map((item) => ({ ...item, query })),
                itemsGeneration
              )
            } catch (error) {
              logger.warn('Failed to load composer suggestion items', { error, pluginKey: source.pluginKey })
              return recordItemsGeneration(
                [
                  {
                    id: `${source.pluginKey}:error`,
                    label: t('common.error'),
                    description: error instanceof Error ? error.message : String(error),
                    disabled: true,
                    command: () => undefined
                  }
                ],
                itemsGeneration
              )
            }
          },
          command: ({ editor, range, props }) => {
            if (props.disabled) return
            editor.chain().focus().deleteRange(range).run()
            props.command({ editor, range, item: props, query: props.query ?? '' })
          },
          render: () => createSuggestionRender(source, pluginKey, () => latestItemsGeneration)
        })
      })
    }
  })
}
