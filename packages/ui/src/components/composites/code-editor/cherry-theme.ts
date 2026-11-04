import { syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView, gutters } from '@codemirror/view'

import { codeBlockHighlightStyle, getCodeBlockPalette } from '../../../code-block'
import { cherryCodeTheme } from '../../../code-highlight'

const palette = getCodeBlockPalette(cherryCodeTheme)

/**
 * CodeMirror chrome for the Cherry default code theme: transparent body, application tokens, shared syntax colors.
 * Gutters scroll with the code; a sticky gutter would need an opaque fill that cannot match the translucent host.
 */
export function createCherryCmTheme(dark: boolean): Extension {
  return [
    EditorView.theme(
      {
        '&': { ...palette, backgroundColor: 'transparent', color: 'var(--code-foreground)' },
        '.cm-content': { caretColor: 'var(--code-caret)' },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--code-caret)' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
          backgroundColor: 'var(--code-selection)'
        },
        '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted-foreground)', border: 'none' },
        '.cm-activeLine': { backgroundColor: 'var(--background-subtle)' },
        '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
        '.cm-panels': { backgroundColor: 'var(--background)', color: 'var(--foreground)' }
      },
      { dark }
    ),
    syntaxHighlighting(codeBlockHighlightStyle),
    gutters({ fixed: false })
  ]
}
