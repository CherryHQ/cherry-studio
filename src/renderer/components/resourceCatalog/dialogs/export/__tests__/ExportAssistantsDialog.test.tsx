import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import type { Assistant } from '@shared/data/types/assistant'

import { ExportAssistantsDialog } from '../ExportAssistantsDialog'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      (en[key as keyof typeof en] ?? key).replace('{{count}}', String(values?.count ?? ''))
  })
}))

const assistants = [
  { id: 'first', name: 'Same name', description: 'Writing' },
  { id: 'second', name: 'Same name', description: 'Coding' },
  { id: 'third', name: 'Other', description: 'Hidden selection' }
] as Assistant[]

describe('ExportAssistantsDialog selection', () => {
  it('waits for a complete load, defaults all IDs, and retains hidden selections through search', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn().mockResolvedValue(undefined)
    const props = { open: true, onOpenChange: vi.fn(), assistants: [], loading: true, exporting: false, onExport }
    const view = render(<ExportAssistantsDialog {...props} />)
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
    view.rerender(<ExportAssistantsDialog {...props} assistants={assistants} loading={false} />)
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(3))
    expect(screen.getAllByRole('checkbox').every((box) => box.getAttribute('aria-checked') === 'true')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Deselect All' }))
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'coding')
    const checkbox = screen.getByRole('checkbox', { name: 'Same name' })
    checkbox.focus()
    await user.keyboard('[Space]')
    expect(checkbox).toBeChecked()
    await user.clear(screen.getByRole('textbox', { name: 'Search' }))
    await user.click(screen.getByRole('checkbox', { name: 'Other' }))
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'writing')
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(onExport).toHaveBeenLastCalledWith(['second', 'third'])
    expect(screen.getByText('Selected 2 items')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Select All' }))
    expect(screen.getByText('Selected 3 items')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Deselect All' }))
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
  })

  it('resets on reopening, blocks busy confirmation and dismisses without exporting', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    const props = { open: true, onOpenChange, assistants, loading: false, exporting: false, onExport }
    const view = render(<ExportAssistantsDialog {...props} />)
    await user.click(screen.getByRole('button', { name: 'Deselect All' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(onExport).not.toHaveBeenCalled()
    view.rerender(<ExportAssistantsDialog {...props} open={false} />)
    view.rerender(<ExportAssistantsDialog {...props} loading assistants={[]} />)
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
    view.rerender(<ExportAssistantsDialog {...props} exporting />)
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
    view.rerender(<ExportAssistantsDialog {...props} />)
    await waitFor(() => expect(screen.getByText('Selected 3 items')).toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })
})
