import type { EditorOptions } from '@tiptap/core'

import { Placeholder, type PlaceholderOptions } from '@renderer/components/RichEditor/extensions/placeholder'

import { ComposerMarkdownLivePreview } from '../markdownLivePreview/livePreviewPlugin'
import {
  ComposerDocument,
  ComposerHardBreak,
  ComposerParagraph,
  ComposerText,
  ComposerUndoRedo
} from '../markdownLivePreview/sourceSchema'
import { ComposerLines } from './composerLines'
import { ComposerTokenNode, type ComposerTokenRenderer } from './ComposerTokenNode'
import { type ComposerSuggestionSource, createComposerSuggestionExtension } from './quickPanel'

export interface ComposerEditorPresetOptions {
  placeholder?: PlaceholderOptions['placeholder']
  enableUndoRedo?: boolean
  markdownLivePreview?: boolean
  renderToken?: ComposerTokenRenderer
  suggestionSources?: readonly ComposerSuggestionSource[]
}

/** Empty lines are ordinary content here, so only a wholly empty document shows the placeholder. */
function showOnBlankDocument(placeholder: PlaceholderOptions['placeholder']): PlaceholderOptions['placeholder'] {
  return (props) => {
    const { doc } = props.editor.state
    if (doc.childCount > 1 || doc.firstChild?.childCount) return ''
    return typeof placeholder === 'function' ? placeholder(props) : (placeholder ?? '')
  }
}

export function createComposerEditorPreset({
  placeholder,
  enableUndoRedo = true,
  markdownLivePreview = false,
  renderToken,
  suggestionSources = []
}: ComposerEditorPresetOptions = {}): EditorOptions['extensions'] {
  return [
    ComposerDocument,
    ComposerParagraph,
    ComposerText,
    ComposerHardBreak,
    ComposerLines,
    Placeholder.configure({
      placeholder: showOnBlankDocument(placeholder),
      showOnlyWhenEditable: true,
      showOnlyCurrent: true,
      includeChildren: false
    }),
    ComposerTokenNode.configure({ renderToken }),
    ...(suggestionSources.length > 0 ? [createComposerSuggestionExtension(suggestionSources)] : []),
    ...(enableUndoRedo ? [ComposerUndoRedo] : []),
    ...(markdownLivePreview ? [ComposerMarkdownLivePreview] : [])
  ]
}
