import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import type { ComponentProps, ReactNode } from 'react'
import { SWRConfig, unstable_serialize } from 'swr'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import * as CherrystudioUI from '@cherrystudio/ui'
import type { ReorderableListProps } from '@cherrystudio/ui'
import { installDndDomStubs } from '@cherrystudio/ui/components/composites/sortable/__tests__/dnd-dom-stubs'
import { dataApiService } from '@data/DataApiService'
import { toast } from '@renderer/services/toast'
import type { Prompt } from '@shared/data/types/prompt'

import { PaintingPromptPresetsDialog } from '../PaintingPromptPresetsDialog'

vi.unmock('@data/hooks/useDataApi')
// Keep real dialogs/form; isolate the editor and drag sensor, covered by their own suites and Electron.
vi.mock('@renderer/components/PromptEditorField', () => ({
  default: ({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: ReactNode }) => (
    <label>
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}))
vi.mock('@renderer/components/resourceCatalog/dialogs/components/PromptPolishActions', () => ({
  PromptPolishActions: () => null
}))
vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherrystudioUI>()
  return {
    ...actual,
    ReorderableList: ({ items, renderItem, onReorder, onReorderError, disabled }: ReorderableListProps<Prompt>) => (
      <div>
        {items.map((item, index) => (
          <div key={item.id}>{renderItem(item, index, { dragging: false })}</div>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            void Promise.resolve(onReorder([...items].reverse())).catch(onReorderError)
          }}>
          Reverse order
        </button>
      </div>
    )
  }
})

const prompt = (index: number, visibility: Prompt['visibility'] = 'global'): Prompt => ({
  id: `018f8f16-3540-7cc2-b3cc-11ef1e3f35a${index}`,
  title: `Preset ${index}`,
  content: `Content ${index}`,
  visibility,
  orderKey: `a${index}`,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z'
})
const seeds = [prompt(1), prompt(2), prompt(3), prompt(4, 'restricted')]
const globalPrompts = seeds.slice(0, 3)
let cache: Map<string, { data?: unknown }>
const get = vi.mocked(dataApiService.get)
const post = vi.mocked(dataApiService.post)
const patch = vi.mocked(dataApiService.patch)
const remove = vi.mocked(dataApiService.delete)

function mount(props: Partial<ComponentProps<typeof PaintingPromptPresetsDialog>> = {}) {
  cache = new Map()
  const onApply = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }}>
      <PaintingPromptPresetsDialog open onApply={onApply} onOpenChange={onOpenChange} {...props} />
    </SWRConfig>
  )
  return { onApply, onOpenChange }
}
const manager = () => screen.getByRole('dialog', { name: 'Manage Global Prompts' })
const editor = (edit = false) => screen.getByRole('dialog', { name: edit ? 'Edit Prompt' : 'Add Prompt' })
const confirm = () => screen.getByRole('dialog', { name: 'Delete Prompt' })

async function openEditor(user: ReturnType<typeof userEvent.setup>, edit = false) {
  await screen.findByRole('button', { name: 'Preset 1' })
  await user.click(
    edit
      ? within(manager()).getAllByRole('button', { name: 'Edit Prompt' })[0]
      : within(manager()).getByRole('button', { name: 'Add Prompt' })
  )
  return editor(edit)
}

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  get
    .mockReset()
    .mockImplementation(
      async (_path, options) =>
        seeds.filter((item) => !options?.query?.visibility || item.visibility === options.query.visibility) as never
    )
  post.mockReset().mockResolvedValue(prompt(5))
  patch.mockReset().mockResolvedValue(prompt(1))
  remove.mockReset().mockResolvedValue(undefined)
})

describe('PaintingPromptPresetsDialog', () => {
  beforeAll(installDndDomStubs)

  it('makes each handle the activator, leaving the row inert, so real drags can start', async () => {
    const actual = await vi.importActual<typeof CherrystudioUI>('@cherrystudio/ui')
    const list = vi.spyOn(CherrystudioUI, 'ReorderableList').mockImplementation(actual.ReorderableList)
    try {
      const user = userEvent.setup()
      get.mockResolvedValue(globalPrompts)
      mount()
      await screen.findByRole('button', { name: 'Preset 1' })

      const rows = manager().querySelectorAll('[data-ui~="part:prompt-preset-row"]')
      expect(rows).toHaveLength(3)
      for (const row of rows) {
        const handle = row.querySelector('[data-ui~="part:prompt-preset-drag"]')
        await waitFor(() => expect(handle).toHaveAttribute('aria-roledescription', 'draggable'))
        expect(handle).toHaveAttribute('aria-describedby')
        expect(row).not.toHaveAttribute('role')
        expect(row).not.toHaveAttribute('aria-roledescription')
        expect(row).not.toHaveAttribute('tabindex')
      }

      const handle = within(manager()).getAllByRole('button', {
        name: i18n.t('settings.prompts.reorder', { title: globalPrompts[0].title })
      })[0]
      handle.focus()
      await user.keyboard('[Space]')
      await waitFor(() => expect(handle).toHaveAttribute('aria-pressed', 'true'))
      await user.keyboard('{Escape}')
      await waitFor(() => expect(handle).toHaveAttribute('aria-pressed', 'false'))
    } finally {
      list.mockRestore()
    }
  })

  it('keeps restricted resources out of the global manager', async () => {
    mount()
    await screen.findByRole('button', { name: 'Preset 1' })
    expect(get).toHaveBeenCalledWith('/prompts', expect.objectContaining({ query: { visibility: 'global' } }))
    expect(screen.queryByRole('button', { name: 'Preset 4' })).not.toBeInTheDocument()
  })

  it('announces loading while the list request is unresolved', () => {
    get.mockReturnValue(new Promise(() => {}))
    mount()
    expect(screen.getByRole('status', { name: 'Loading...' })).toBeVisible()
  })

  it('explains an empty list and still offers creation', async () => {
    get.mockResolvedValue([] as never)
    mount()
    expect(await screen.findByText('No prompts')).toBeVisible()
    expect(within(manager()).getByRole('button', { name: 'Add Prompt' })).toBeEnabled()
  })

  it('recovers a failed GET without dismissing the manager', async () => {
    const user = userEvent.setup()
    get.mockRejectedValueOnce(new Error('offline'))
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load prompts')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Preset 1' })).toBeVisible()
  })

  it('applies the selected content and asks the owner to close', async () => {
    const user = userEvent.setup()
    const { onApply, onOpenChange } = mount()
    await user.click(await screen.findByRole('button', { name: 'Preset 2' }))
    expect(onApply).toHaveBeenCalledWith('Content 2')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('creates through POST and retains whitespace content and explicit restricted visibility', async () => {
    const user = userEvent.setup()
    mount()
    const form = await openEditor(user)
    await user.type(within(form).getByRole('textbox', { name: 'Title' }), 'New title')
    await user.type(within(form).getByRole('textbox', { name: 'Content' }), '   ')
    await user.click(within(form).getByRole('switch'))
    await user.click(within(form).getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/prompts',
        expect.objectContaining({
          body: { title: 'New title', content: '   ', visibility: 'restricted' }
        })
      )
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Prompt' })).not.toBeInTheDocument())
  })

  it('retains a failed creation so the same values can be retried', async () => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce(new Error('offline'))
    mount()
    const form = await openEditor(user)
    await user.type(within(form).getByRole('textbox', { name: 'Title' }), 'Retry title')
    await user.type(within(form).getByRole('textbox', { name: 'Content' }), 'Retry content')
    await user.click(within(form).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Failed to create prompt')))
    expect(within(editor()).getByRole('textbox', { name: 'Title' })).toHaveValue('Retry title')
    expect(within(editor()).getByRole('textbox', { name: 'Content' })).toHaveValue('Retry content')
    await user.click(within(editor()).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Prompt' })).not.toBeInTheDocument())
  })

  it('edits the selected UUID with PATCH without applying its new content', async () => {
    const user = userEvent.setup()
    const { onApply } = mount()
    const form = await openEditor(user, true)
    expect(within(form).getByRole('textbox', { name: 'Content' })).toHaveValue('Content 1')
    await user.clear(within(form).getByRole('textbox', { name: 'Title' }))
    await user.type(within(form).getByRole('textbox', { name: 'Title' }), 'Edited')
    await user.click(within(form).getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        `/prompts/${seeds[0].id}`,
        expect.objectContaining({
          body: { title: 'Edited', content: 'Content 1', visibility: 'global' }
        })
      )
    )
    expect(onApply).not.toHaveBeenCalled()
  })

  it('keeps unsaved edits after a PATCH failure', async () => {
    const user = userEvent.setup()
    patch.mockRejectedValueOnce(new Error('offline'))
    mount()
    const form = await openEditor(user, true)
    await user.type(within(form).getByRole('textbox', { name: 'Title' }), ' changed')
    await user.click(within(form).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Failed to update prompt')))
    expect(within(editor(true)).getByRole('textbox', { name: 'Title' })).toHaveValue('Preset 1 changed')
    await user.click(within(editor(true)).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Prompt' })).not.toBeInTheDocument())
  })

  it('cancels deletion without a request, then deletes the selected UUID without applying anything', async () => {
    const user = userEvent.setup()
    const { onApply } = mount()
    await screen.findByRole('button', { name: 'Preset 1' })
    const deleteFirst = () => within(manager()).getAllByRole('button', { name: 'Delete Prompt' })[0]
    await user.click(deleteFirst())
    await user.click(within(confirm()).getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
    await user.click(deleteFirst())
    await user.click(within(confirm()).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(`/prompts/${seeds[0].id}`, expect.anything()))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('retains the deletion target when DELETE fails and allows retry', async () => {
    const user = userEvent.setup()
    remove.mockRejectedValueOnce(new Error('offline'))
    mount()
    await screen.findByRole('button', { name: 'Preset 1' })
    await user.click(within(manager()).getAllByRole('button', { name: 'Delete Prompt' })[0])
    await user.click(within(confirm()).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Failed to delete prompt')))
    expect(confirm()).toBeVisible()
    await user.click(within(confirm()).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete Prompt' })).not.toBeInTheDocument())
  })

  it('persists multiple order moves using the global cache, blocking conflicting actions while pending', async () => {
    const user = userEvent.setup()
    let resolve!: (value: never) => void
    patch.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    mount()
    await screen.findByRole('button', { name: 'Preset 1' })
    await user.click(screen.getByRole('button', { name: 'Reverse order' }))
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        '/prompts/order:batch',
        expect.objectContaining({
          body: { moves: expect.arrayContaining([expect.objectContaining({ id: seeds[2].id })]) }
        })
      )
    )
    const ordered = cache.get(unstable_serialize(['/prompts', { visibility: 'global' }]))?.data as Prompt[]
    expect(ordered.map((item) => item.id)).toEqual(globalPrompts.map((item) => item.id).reverse())
    expect(within(manager()).getByRole('button', { name: 'Add Prompt' })).toBeDisabled()
    resolve(undefined as never)
    await waitFor(() => expect(within(manager()).getByRole('button', { name: 'Add Prompt' })).toBeEnabled())
  })

  it('reports a reorder failure and restores the server order in the global cache', async () => {
    const user = userEvent.setup()
    patch.mockRejectedValueOnce(new Error('offline'))
    mount()
    await screen.findByRole('button', { name: 'Preset 1' })
    await user.click(screen.getByRole('button', { name: 'Reverse order' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Failed to reorder prompts')))
    await waitFor(() =>
      expect(cache.get(unstable_serialize(['/prompts', { visibility: 'global' }]))?.data).toEqual(globalPrompts)
    )
  })
})
