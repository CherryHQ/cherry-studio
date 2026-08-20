import { Extension, mergeAttributes, Node } from '@tiptap/core'
import { history, redo, undo } from '@tiptap/pm/history'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    composerHardBreak: {
      setHardBreak: () => ReturnType
    }
    composerUndoRedo: {
      undo: () => ReturnType
      redo: () => ReturnType
    }
  }
}

export const ComposerDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+'
})

export const ComposerParagraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',

  parseHTML() {
    return [{ tag: 'p' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes), 0]
  }
})

export const ComposerText = Node.create({
  name: 'text',
  group: 'inline'
})

export const ComposerHardBreak = Node.create({
  name: 'hardBreak',
  inline: true,
  group: 'inline',
  selectable: false,
  linebreakReplacement: true,

  parseHTML() {
    return [{ tag: 'br' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['br', mergeAttributes(HTMLAttributes)]
  },

  renderText() {
    return '\n'
  },

  addCommands() {
    return {
      setHardBreak:
        () =>
        ({ chain }) => {
          return chain().insertContent({ type: this.name }).scrollIntoView().run()
        }
    }
  }

  // No keyboard shortcuts here: which Enter combination inserts a line break is a user
  // preference, so ComposerSurfaceRuntime routes every Enter key itself.
})

export interface ComposerUndoRedoOptions {
  depth: number
  newGroupDelay: number
}

export const ComposerUndoRedo = Extension.create<ComposerUndoRedoOptions>({
  name: 'composerUndoRedo',

  addOptions() {
    return {
      depth: 100,
      newGroupDelay: 500
    }
  },

  addCommands() {
    return {
      undo:
        () =>
        ({ state, dispatch }) => {
          return undo(state, dispatch)
        },
      redo:
        () =>
        ({ state, dispatch }) => {
          return redo(state, dispatch)
        }
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-z': () => this.editor.commands.undo(),
      'Shift-Mod-z': () => this.editor.commands.redo(),
      'Mod-y': () => this.editor.commands.redo()
    }
  },

  addProseMirrorPlugins() {
    return [history(this.options)]
  }
})
