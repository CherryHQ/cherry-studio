import { Editor, type JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createComposerDraftContent, serializeComposerDocument } from '../../composer/composerDraft'
import { createComposerInputAdapter } from '../../composer/composerInputAdapter'
import { getComposerPlainTextPasteOverride } from '../../composer/composerPaste'
import { createComposerEditorPreset } from '../../composer/composerPreset'
import { createPromptVariableInlineContent, tokenizePromptVariablesInEditor } from '../../composer/promptVariables'
import type { ComposerDraftToken } from '../../composer/tokens'

const editors: Editor[] = []

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

/** Writes tokens as `<id>` so one string shows which spans stayed literal. */
const describeInline = (content: readonly JSONContent[]) =>
  content
    .map((node) => {
      if (node.type === 'hardBreak') return '\n'
      return node.type === 'text' ? node.text : `<${node.attrs?.id}>`
    })
    .join('')
const describeDoc = (doc: JSONContent) =>
  (doc.content ?? []).map((paragraph) => describeInline(paragraph.content ?? [])).join('\n')

const variable = (index: number, name: string) => `<prompt-variable:${index}:${name}>`

describe('text-level insertion', () => {
  const describeText = (text: string, literalFencedCode = true) =>
    describeInline(createPromptVariableInlineContent(text, { literalFencedCode }))

  it('leaves variables in a fenced block literal and numbers the rest without gaps', () => {
    expect(describeText('${a}\n```\n${b}\n```\n${c}')).toBe(
      `${variable(0, 'a')}\n\`\`\`\n\${b}\n\`\`\`\n${variable(1, 'c')}`
    )
  })

  it.each([
    ['an unterminated fence', '```\n${a}\n\n${b}'],
    ['a tilde fence', '~~~js\n${a}\n~~~'],
    ['a fence inside a quote', '> ```\n> ${a}\n> ```'],
    ['the opening fence line', '```${a}\ncode\n```']
  ])('keeps %s literal', (_name, text) => {
    expect(describeText(text)).toBe(text)
  })

  it('maps fenced lines correctly across Windows line endings', () => {
    expect(describeText('```\r\n${a}\r\n```\r\n${b}')).toBe(`\`\`\`\n\${a}\n\`\`\`\n${variable(0, 'b')}`)
  })

  it('tokenizes the line right after a closing fence', () => {
    expect(describeText('```\ncode\n```\n${a}')).toBe(`\`\`\`\ncode\n\`\`\`\n${variable(0, 'a')}`)
  })

  it.each([
    ['four-space indentation', '\n    ${a}', `\n    ${variable(0, 'a')}`],
    ['inline code', 'run `${a}` now', `run \`${variable(0, 'a')}\` now`]
  ])('still tokenizes %s', (_name, text, expected) => {
    expect(describeText(text)).toBe(expected)
  })

  it('keeps fenced text tokenized on surfaces without live preview', () => {
    expect(describeText('```\n${a}\n```', false)).toBe(`\`\`\`\n${variable(0, 'a')}\n\`\`\``)
  })

  it('restores a draft with its fenced variables literal', () => {
    const doc = createComposerDraftContent({ text: '${a}\n```\n${b}\n```', tokens: [] }, { literalFencedCode: true })

    expect(describeDoc(doc)).toBe(`${variable(0, 'a')}\n\`\`\`\n\${b}\n\`\`\``)
  })

  describe('paste', () => {
    const skill = { id: 'skill:pdf', kind: 'skill', label: 'pdf' } as ComposerDraftToken
    const knowledge = { id: 'kb:docs', kind: 'knowledge', label: 'docs' } as ComposerDraftToken
    const paste = (text: string, literalFencedCode = true) =>
      getComposerPlainTextPasteOverride(text, {
        literalFencedCode,
        resolveSkillMarker: (marker) => (marker === 'pdf' ? skill : null),
        resolveKnowledgeBaseMarker: (marker) => (marker === 'docs' ? knowledge : null)
      }) ?? []

    it('keeps skill and knowledge markers in a fenced block as text', () => {
      const text = '```\n/pdf/ #docs# ${a}\n```'

      expect(describeInline(paste(text))).toBe(text)
    })

    it('still recognizes markers around the block', () => {
      expect(describeInline(paste('/pdf/ x\n```\n/pdf/\n```\n${a}'))).toBe(
        `<skill:pdf> x\n\`\`\`\n/pdf/\n\`\`\`\n${variable(0, 'a')}`
      )
    })
  })
})

describe('editing a live-preview draft', () => {
  function createEditor(text: string, markdownLivePreview = true) {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: createComposerEditorPreset({ markdownLivePreview }),
      content: createComposerDraftContent({ text, tokens: [] }, { tokenizeVariables: false })
    })
    editor.on('update', ({ editor: updated, transaction }) => {
      tokenizePromptVariablesInEditor(updated, transaction)
    })
    editors.push(editor)
    return editor
  }
  const lineStart = (editor: Editor, line: number) => {
    let position = 1
    editor.state.doc.forEach((_block, offset, index) => {
      if (index === line) position = offset + 1
    })
    return position
  }
  const describeEditor = (editor: Editor) => describeDoc(editor.getJSON())
  const type = (editor: Editor, text: string, line: number) =>
    editor.view.dispatch(editor.state.tr.insertText(text, lineStart(editor, line)))

  it('leaves a typed variable literal inside a fenced block', () => {
    const editor = createEditor('```\ncode\n```')

    type(editor, '${HOME}', 1)

    expect(describeEditor(editor)).toBe('```\n${HOME}code\n```')
  })

  it('leaves a typed variable literal in an unterminated block', () => {
    const editor = createEditor('```js\nconst s = ')

    type(editor, '${name}', 1)

    expect(describeEditor(editor)).toBe('```js\n${name}const s = ')
  })

  it('tokenizes a variable typed outside the block', () => {
    const editor = createEditor('plain\n```\ncode\n```')

    type(editor, '${HOME}', 0)

    expect(describeEditor(editor)).toBe(`${variable(0, 'HOME')}plain\n\`\`\`\ncode\n\`\`\``)
  })

  it('tokenizes a variable typed on a four-space line', () => {
    const editor = createEditor('intro\n\n    code')

    type(editor, '${HOME}', 2)

    expect(describeEditor(editor)).toBe(`intro\n\n${variable(0, 'HOME')}    code`)
  })

  it('keeps tokenizing inside fences on surfaces without live preview', () => {
    const editor = createEditor('```\ncode\n```', false)

    type(editor, '${HOME}', 1)

    expect(describeEditor(editor)).toBe(`\`\`\`\n${variable(0, 'HOME')}code\n\`\`\``)
  })

  describe('panel insertion', () => {
    it('inserts literally with the caret inside a block', () => {
      const editor = createEditor('```\n\n```')
      editor.commands.setTextSelection(lineStart(editor, 1))

      createComposerInputAdapter(editor).insertText('${a}')

      expect(describeEditor(editor)).toBe('```\n${a}\n```')
    })

    it('tokenizes around a fenced block that arrives as one piece', () => {
      const editor = createEditor('')

      createComposerInputAdapter(editor).insertText('${a}\n```\n${b}\n```')

      expect(describeEditor(editor)).toBe(`${variable(0, 'a')}\n\`\`\`\n\${b}\n\`\`\``)
    })

    it('keeps the serialized draft free of tokens for literal code', () => {
      const editor = createEditor('```\n\n```')
      editor.commands.setTextSelection(lineStart(editor, 1))

      createComposerInputAdapter(editor).insertText('${a}')

      expect(serializeComposerDocument(editor)).toEqual({ text: '```\n${a}\n```', tokens: [] })
    })
  })
})

describe.each(['/', '@'])('QuickPanel trigger %s', (char) => {
  async function typeTriggerOnLine(text: string, line: number, replaceAll = false) {
    const onActiveChange = vi.fn()
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: createComposerEditorPreset({
        markdownLivePreview: true,
        suggestionSources: [
          { pluginKey: 'test-preview-suggestion', char, allowedPrefixes: [' ', '\n'], onActiveChange, items: () => [] }
        ]
      }),
      content: createComposerDraftContent({ text, tokens: [] }, { tokenizeVariables: false })
    })
    editors.push(editor)

    let position = 1
    editor.state.doc.forEach((_block, offset, index) => {
      if (index === line) position = offset + 1
    })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)))
    if (replaceAll) editor.commands.selectAll()
    editor.view.dispatch(editor.state.tr.insertText(char))
    await Promise.resolve()
    await Promise.resolve()
    return onActiveChange
  }

  it.each(['```\n```', '```'])('opens immediately when replacing %j with the trigger', async (text) => {
    const onActiveChange = await typeTriggerOnLine(text, 0, true)
    expect(onActiveChange).toHaveBeenCalledWith(expect.objectContaining({ text: char, query: '' }))
  })

  it.each([
    ['a closed block', '```\ncode\n```', 1],
    ['an unterminated block', '```\ncode', 1]
  ])('does not open inside %s', async (_name, text, line) => {
    expect(await typeTriggerOnLine(text, line)).not.toHaveBeenCalled()
  })

  it.each([
    ['a plain line', 'plain\n```\ncode\n```', 0],
    ['a four-space line', 'intro\n\n    code', 2]
  ])('still opens on %s', async (_name, text, line) => {
    expect(await typeTriggerOnLine(text, line)).toHaveBeenCalled()
  })
})
