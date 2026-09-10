// The front-matter contract is the subject; real @cherrystudio/ui primitives are rendered
// because the global stand-in has no TreeSelect and nothing here depends on primitive behavior.
vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal())

const { ipcRequest, exportMarkdownToObsidian } = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  exportMarkdownToObsidian: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequest, on: vi.fn(() => () => {}) }
}))

vi.mock('@renderer/services/ExportService', () => ({
  exportMarkdownToObsidian,
  messagesToMarkdown: vi.fn(),
  messageToMarkdown: vi.fn(),
  messageToMarkdownWithReasoning: vi.fn(),
  topicToMarkdown: vi.fn()
}))

import { ObsidianProcessingMethod, PopupContainer } from '@renderer/components/ObsidianExportDialog'
import i18n from '@renderer/i18n/resolver'
import { mockUsePreference } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import matter from 'gray-matter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const body = '# Body\n\nHello from the chat.'

beforeEach(() => {
  vi.clearAllMocks()
  // The vault-loading effect depends on a stable preference setter.
  mockUsePreference.mockReturnValue(['', vi.fn()])
  ipcRequest.mockImplementation(async (route: string) => {
    if (route === 'export.obsidian.get_vaults') return [{ name: 'Notes', path: '/vaults/Notes' }]
    if (route === 'export.obsidian.get_files') return []
    return undefined
  })
  exportMarkdownToObsidian.mockResolvedValue(true)
})

afterEach(cleanup)

const exportNewNote = async (title: string, tags: string) => {
  const user = userEvent.setup()
  render(
    <PopupContainer
      title={title}
      obsidianTags={tags}
      processingMethod={ObsidianProcessingMethod.NEW_OR_OVERWRITE}
      open
      resolve={vi.fn()}
      rawContent={body}
    />
  )

  const confirm = await screen.findByRole('button', { name: i18n.t('chat.topics.export.obsidian_btn') })
  await waitFor(() => expect(confirm).toBeEnabled())
  await user.click(confirm)
  await waitFor(() => expect(exportMarkdownToObsidian).toHaveBeenCalled())

  return matter(await navigator.clipboard.readText())
}

describe('ObsidianExportDialog front matter', () => {
  it('keeps a ": " title and turns comma-separated "#" tags into a plain tag list', async () => {
    const note = await exportNewNote('Meeting: sprint planning', '#work, notes')

    expect(note.data.title).toBe('Meeting: sprint planning')
    expect(note.data.tags).toEqual(['work', 'notes'])
    expect(note.content.trim()).toBe(body)
  })

  it('keeps a title starting with "#" instead of turning it into a YAML comment', async () => {
    const note = await exportNewNote('# Draft', '')

    expect(note.data.title).toBe('# Draft')
  })

  it.each(['["work", "notes"]', "['work', 'notes']", '[ "work", "notes" ]'])(
    'parses the quoted tag list %s without keeping the quotes',
    async (input) => {
      const note = await exportNewNote('Weekly sync', input)

      expect(note.data.tags).toEqual(['work', 'notes'])
    }
  )

  it('turns a bare bracketed list like [work, notes] into two clean tags', async () => {
    const note = await exportNewNote('Weekly sync', '[work, notes]')

    expect(note.data.tags).toEqual(['work', 'notes'])
  })

  it('keeps an empty list from becoming a literal tag', async () => {
    const note = await exportNewNote('Weekly sync', '[]')

    expect(note.data.tags).toEqual([])
  })

  it('falls back to comma splitting when a hash makes the list invalid YAML', async () => {
    const note = await exportNewNote('Weekly sync', '[work, #notes]')

    expect(note.data.tags).toEqual(['work', 'notes'])
  })

  it('keeps a long title on a single front matter line', async () => {
    const longTitle =
      'Meeting: sprint planning retrospective for the payments team covering incident review and roadmap alignment'
    const note = await exportNewNote(longTitle, '')

    expect(note.data.title).toBe(longTitle)
    expect(note.matter.split('\n').some((line) => line.includes(longTitle))).toBe(true)
  })
})
