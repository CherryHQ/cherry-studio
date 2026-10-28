import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { CommandSharedPreferencesContext } from '@renderer/hooks/command'

import ImageBlock from '../ImageBlock'
import MessageImageBlock from '../MessageImageBlock'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.unmock('@cherrystudio/ui')

it('keeps the PNG preview open when an earlier grouped HEIF rendition finishes', async () => {
  const user = userEvent.setup()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:message-png') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  let resolveRendition!: (result: { content: Uint8Array }) => void
  mocks.request.mockReturnValue(
    new Promise((resolve) => {
      resolveRendition = resolve
    })
  )
  const { container } = render(
    <CommandSharedPreferencesContext value={{ menuPresentationMode: 'cherry', shortcutPreferences: {} }}>
      <MessageImageBlock
        sources={[
          { url: 'file:///tmp/photo.heic', mediaType: 'image/heic' },
          { url: 'file:///tmp/ordinary.png', mediaType: 'image/png' }
        ]}
      />
    </CommandSharedPreferencesContext>
  )
  expect(screen.getByRole('status')).toBeInTheDocument()
  const thumbnail = screen.getByRole('img')
  expect(thumbnail).toHaveAttribute('src', 'file:///tmp/ordinary.png')
  await user.click(thumbnail)
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByAltText('')).toHaveAttribute('src', 'file:///tmp/ordinary.png')

  await act(async () => resolveRendition({ content: new Uint8Array([137, 80, 78, 71]) }))

  expect(within(container).getAllByRole('img', { hidden: true })).toHaveLength(2)
  expect(within(container).getAllByRole('img', { hidden: true })[0]).toHaveAttribute('src', 'blob:message-png')
  expect(within(container).queryByRole('status', { hidden: true })).not.toBeInTheDocument()
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(within(dialog).getByAltText('')).toHaveAttribute('src', 'file:///tmp/ordinary.png')
})

it('opens a gallery supplied as plain strings', async () => {
  const user = userEvent.setup()
  render(
    <CommandSharedPreferencesContext value={{ menuPresentationMode: 'cherry', shortcutPreferences: {} }}>
      <ImageBlock images={['file:///tmp/first.png', 'file:///tmp/second.png']} />
    </CommandSharedPreferencesContext>
  )

  await user.click(screen.getAllByRole('img')[1])

  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByAltText('')).toHaveAttribute('src', 'file:///tmp/second.png')
})
