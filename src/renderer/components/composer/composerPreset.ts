import type { EditorOptions } from '@tiptap/core'

import { Placeholder, type PlaceholderOptions } from '@renderer/components/RichEditor/extensions/placeholder'

import { ComposerMarkdownPreviewPrototype } from './composerMarkdownPreview.prototype'
import {
  ComposerDocument,
  ComposerHardBreak,
  ComposerParagraph,
  ComposerText,
  ComposerUndoRedo
} from './composerSchema'
import { ComposerTokenNode, type ComposerTokenRenderer } from './ComposerTokenNode'
import { type ComposerSuggestionSource, createComposerSuggestionExtension } from './quickPanel'

export interface ComposerEditorPresetOptions {
  placeholder?: PlaceholderOptions['placeholder']
  enableUndoRedo?: boolean
  renderToken?: ComposerTokenRenderer
  suggestionSources?: readonly ComposerSuggestionSource[]
}

export function createComposerEditorPreset({
  placeholder,
  enableUndoRedo = true,
  renderToken,
  suggestionSources = []
}: ComposerEditorPresetOptions = {}): EditorOptions['extensions'] {
  return [
    ComposerDocument,
    ComposerParagraph,
    ComposerText,
    ComposerHardBreak,
    Placeholder.configure({
      // One paragraph per line would otherwise show the hint on every empty line the caret visits.
      placeholder: (props) => {
        if (!props.editor.isEmpty) return ''
        return typeof placeholder === 'function' ? placeholder(props) : (placeholder ?? '')
      },
      showOnlyWhenEditable: true,
      showOnlyCurrent: true,
      includeChildren: false
    }),
    ComposerTokenNode.configure({ renderToken }),
    ComposerMarkdownPreviewPrototype,
    ...(suggestionSources.length > 0 ? [createComposerSuggestionExtension(suggestionSources)] : []),
    ...(enableUndoRedo ? [ComposerUndoRedo] : [])
  ]
}
