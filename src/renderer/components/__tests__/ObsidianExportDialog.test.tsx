// Destination selection uses the real TreeSelect, which is absent from the global stand-in.
vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal())

const { ipcRequest } = vi.hoisted(() => ({ ipcRequest: vi.fn() }))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequest, on: vi.fn(() => () => {}) }
}))

import { mockUsePreference } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import matter from 'gray-matter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ObsidianProcessingMethod, PopupContainer } from '@renderer/components/ObsidianExportDialog'
import i18n from '@renderer/i18n/resolver'

const body = '# Body\n\nHello from the chat.'

beforeEach(() => {
  vi.clearAllMocks()
  // The vault-loading effect depends on a stable preference setter.
  mockUsePreference.mockReturnValue(['', vi.fn()])
  ipcRequest.mockImplementation(async (route: string) => {
    if (route === 'export.obsidian.get_vaults') return [{ name: 'Notes', path: '/vaults/Notes' }]
    if (route === 'export.obsidian.get_files')
      return [
        { path: 'Archive.md', name: 'Archive.md', type: 'folder' },
        { path: 'Archive.md/Log.md', name: 'Log.md', type: 'markdown' }
      ]
    return undefined
  })
  vi.spyOn(window, 'open').mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const exportNewNote = async (
  title: string,
  tags: string,
  selections: string[] = [],
  processingMethod: React.ComponentProps<
    typeof PopupContainer
  >['processingMethod'] = ObsidianProcessingMethod.NEW_OR_OVERWRITE
) => {
  const user = userEvent.setup()
  render(
    <PopupContainer
      title={title}
      obsidianTags={tags}
      processingMethod={processingMethod}
      open
      resolve={vi.fn()}
      rawContent={body}
    />
  )

  const confirm = await screen.findByRole('button', { name: i18n.t('chat.topics.export.obsidian_btn') })
  await waitFor(() => expect(confirm).toBeEnabled())
  const root = i18n.t('chat.topics.export.obsidian_root_directory')
  let selected = root
  for (const selection of selections) {
    const next = selection || root
    await user.click(await screen.findByText(selected, { selector: '[role="combobox"] span' }))
    await user.type(screen.getByPlaceholderText(i18n.t('common.search')), next)
    await user.click(screen.getByRole('treeitem', { name: (name) => name.includes(next) }))
    selected = next
  }
  await user.click(confirm)
  await waitFor(() => expect(window.open).toHaveBeenCalled())

  return matter(await navigator.clipboard.readText())
}

describe('Obsidian export destination', () => {
  it.each([
    { selections: ['Archive.md'], path: 'Archive.md/Meeting.md', mode: 'overwrite' },
    { selections: ['Log.md'], path: 'Archive.md/Log.md', mode: 'append' },
    { selections: ['Log.md', ''], path: 'Meeting.md', mode: 'overwrite' },
    { selections: ['Archive.md', ''], initialMode: ObsidianProcessingMethod.APPEND, path: 'Meeting.md', mode: 'append' }
  ])('opens $path with $mode', async ({ selections, initialMode, path, mode }) => {
    await exportNewNote('Meeting', '', selections, initialMode)
    const params = new URL(String(vi.mocked(window.open).mock.calls[0][0])).searchParams
    expect(params.get('file')).toBe(path)
    expect(params.get(mode)).toBe('true')
  })
})

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
