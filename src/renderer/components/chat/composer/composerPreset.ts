import type { EditorOptions } from '@tiptap/core'

import { Placeholder } from '../../RichEditor/extensions/placeholder'
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
  placeholder?: string
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
      placeholder,
      showOnlyWhenEditable: true,
      showOnlyCurrent: true,
      includeChildren: false
    }),
    ComposerTokenNode.configure({ renderToken }),
    ...(suggestionSources.length > 0 ? [createComposerSuggestionExtension(suggestionSources)] : []),
    ...(enableUndoRedo ? [ComposerUndoRedo] : [])
  ]
}
