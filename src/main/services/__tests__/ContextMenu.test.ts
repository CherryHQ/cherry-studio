import { beforeEach, describe, expect, it, vi } from 'vitest'

const { menuMock, tMock, loggerMock } = vi.hoisted(() => {
  const popupMock = vi.fn()
  return {
    menuMock: {
      buildFromTemplate: vi.fn(() => ({ popup: popupMock }))
    },
    tMock: vi.fn((key: string) => key),
    loggerMock: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
  }
})

vi.mock('electron', () => ({
  Menu: menuMock
}))

vi.mock('@main/i18n', () => ({
  t: tMock
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

import { contextMenu } from '../ContextMenu'

type MenuTemplateItem = {
  id?: string
  label?: string
  enabled?: boolean
  type?: string
  click?: () => void
}

const latestTemplate = (): MenuTemplateItem[] => {
  const calls = menuMock.buildFromTemplate.mock.calls as unknown as [MenuTemplateItem[]][]
  return calls.at(-1)?.[0] ?? []
}

const baseEditFlags = {
  canUndo: false,
  canRedo: false,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canDelete: false,
  canSelectAll: true,
  canEditRichly: false
}

const editableSpellParams = (partial: {
  selectionText: string
  misspelledWord: string
  dictionarySuggestions: string[]
}): Electron.ContextMenuParams =>
  ({
    isEditable: true,
    editFlags: baseEditFlags,
    ...partial
  }) as unknown as Electron.ContextMenuParams

describe('contextMenu spell-check dictionary actions', () => {
  let preventDefault: ReturnType<typeof vi.fn<() => void>>
  let addWord: ReturnType<typeof vi.fn<(word: string) => boolean>>
  let removeWord: ReturnType<typeof vi.fn<(word: string) => boolean>>
  let listWords: ReturnType<typeof vi.fn<() => Promise<string[]>>>
  let replaceMisspelling: ReturnType<typeof vi.fn>
  let onContextMenu: (event: { preventDefault: () => void }, properties: Electron.ContextMenuParams) => void

  beforeEach(() => {
    vi.clearAllMocks()
    preventDefault = vi.fn<() => void>()
    addWord = vi.fn<(word: string) => boolean>(() => true)
    removeWord = vi.fn<(word: string) => boolean>(() => true)
    listWords = vi.fn<() => Promise<string[]>>(async () => [])
    replaceMisspelling = vi.fn()

    const webContents = {
      on: vi.fn((eventName: string, listener: typeof onContextMenu) => {
        if (eventName === 'context-menu') {
          onContextMenu = listener
        }
      }),
      session: {
        addWordToSpellCheckerDictionary: addWord,
        removeWordFromSpellCheckerDictionary: removeWord,
        listWordsInSpellCheckerDictionary: listWords
      },
      replaceMisspelling,
      toggleDevTools: vi.fn()
    }

    contextMenu.contextMenu(webContents as unknown as Electron.WebContents)
  })

  it('learns a misspelled word through the session dictionary API', async () => {
    listWords.mockResolvedValue([])

    onContextMenu(
      { preventDefault },
      editableSpellParams({
        selectionText: 'missspelled',
        misspelledWord: 'missspelled',
        dictionarySuggestions: ['misspelled']
      })
    )

    await vi.waitFor(() => expect(menuMock.buildFromTemplate).toHaveBeenCalled())

    const learn = latestTemplate().find((item) => item.id === 'learnSpelling')
    expect(learn).toBeDefined()
    learn?.click?.()
    expect(addWord).toHaveBeenCalledWith('missspelled')
  })

  it('unlearns a previously learned word selected in an editable field', async () => {
    // Regression for #20570: Learn Spelling had no reverse path once the word stopped being misspelled.
    listWords.mockResolvedValue(['CherryAI'])

    onContextMenu(
      { preventDefault },
      editableSpellParams({
        selectionText: 'CherryAI',
        misspelledWord: '',
        dictionarySuggestions: []
      })
    )

    await vi.waitFor(() => expect(menuMock.buildFromTemplate).toHaveBeenCalled())

    const unlearn = latestTemplate().find((item) => item.id === 'unlearnSpelling')
    expect(unlearn).toBeDefined()
    expect(unlearn?.label).toBe('context_menu.spell_check.unlearn')
    unlearn?.click?.()
    expect(removeWord).toHaveBeenCalledWith('CherryAI')
  })

  it('logs and does not throw when removeWordFromSpellCheckerDictionary returns false', async () => {
    listWords.mockResolvedValue(['CherryAI'])
    removeWord.mockReturnValue(false)

    onContextMenu(
      { preventDefault },
      editableSpellParams({
        selectionText: 'CherryAI',
        misspelledWord: '',
        dictionarySuggestions: []
      })
    )

    await vi.waitFor(() => expect(menuMock.buildFromTemplate).toHaveBeenCalled())

    latestTemplate()
      .find((item) => item.id === 'unlearnSpelling')
      ?.click?.()
    expect(removeWord).toHaveBeenCalledWith('CherryAI')
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Failed to remove word from spellchecker dictionary',
      expect.objectContaining({ word: 'CherryAI' })
    )
  })

  it('does not invent an Unlearn action when the custom dictionary is empty', async () => {
    listWords.mockResolvedValue([])

    onContextMenu(
      { preventDefault },
      editableSpellParams({
        selectionText: 'CherryAI',
        misspelledWord: '',
        dictionarySuggestions: []
      })
    )

    await vi.waitFor(() => expect(menuMock.buildFromTemplate).toHaveBeenCalled())

    expect(latestTemplate().some((item) => item.id === 'unlearnSpelling')).toBe(false)
    expect(removeWord).not.toHaveBeenCalled()
  })
})
