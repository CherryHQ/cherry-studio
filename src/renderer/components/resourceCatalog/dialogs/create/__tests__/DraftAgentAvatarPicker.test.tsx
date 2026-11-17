import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as Ui from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'
import { checkEntityImageSize, prepareEntityImageBytes } from '@renderer/utils/image'

import { DraftAgentAvatarPicker } from '../DraftAgentAvatarPicker'

vi.mock('@cherrystudio/ui', async (original) => original<typeof Ui>())
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/utils/image', () => ({ checkEntityImageSize: vi.fn(), prepareEntityImageBytes: vi.fn() }))
vi.mock('@renderer/components/EmojiPicker', () => ({
  EmojiPicker: ({ onEmojiClick }: { onEmojiClick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onEmojiClick('🎓')}>
      Graduation cap
    </button>
  )
}))
const bytes = new Uint8Array([1, 2, 3])
const file = new File(['image'], 'avatar.png', { type: 'image/png' })
const label = 'library.config.dialogs.create.avatar_aria'
const uploadLabel = 'settings.general.image_upload'
const onPendingChange = vi.fn()

function Harness({ active = true }: { active?: boolean }) {
  const [draft, setDraft] = useState<{ emoji: string; image?: Uint8Array<ArrayBuffer> }>({ emoji: '🤖' })
  return (
    <>
      <DraftAgentAvatarPicker
        {...draft}
        fallback="🧪"
        active={active}
        disabled={false}
        portalContainer={null}
        onPendingChange={onPendingChange}
        onChange={(emoji, image) => setDraft({ emoji, image })}
      />
      <output>{draft.image ? 'image draft' : draft.emoji}</output>
    </>
  )
}

beforeEach(() => {
  vi.mocked(checkEntityImageSize).mockReset().mockReturnValue(null)
  vi.mocked(prepareEntityImageBytes).mockReset().mockResolvedValue(bytes)
  URL.createObjectURL = vi.fn(() => 'blob:avatar-preview')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function openUpload() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: label }))
  return { user, input: screen.getByLabelText(uploadLabel) }
}

// Catches loss of a selected avatar after errors/cancel, or async writes to a closed draft.
describe('draft Agent avatar', () => {
  it('previews an image selected after the avatar menu is dismissed', async () => {
    render(<Harness />)
    const { user, input } = await openUpload()
    await user.click(screen.getByRole('button', { name: uploadLabel }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: uploadLabel })).not.toBeInTheDocument()

    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByRole('img', { name: 'common.avatar' })).toHaveAttribute('src', 'blob:avatar-preview')
    expect(screen.getByRole('status')).toHaveTextContent('image draft')
  })

  it('previews the selected image, preserves it on cancellation, then clears it for an emoji and reset', async () => {
    render(<Harness />)
    let { user, input } = await openUpload()
    await user.upload(input, file)
    expect(await screen.findByRole('img', { name: 'common.avatar' })).toHaveAttribute('src', 'blob:avatar-preview')
    expect(screen.getByRole('status')).toHaveTextContent('image draft')
    ;({ user, input } = await openUpload())
    await user.upload(input, [])
    expect(screen.getByRole('status')).toHaveTextContent('image draft')
    await user.keyboard('{Escape}')
    await openUpload()
    await user.click(screen.getByRole('button', { name: 'settings.general.emoji_picker' }))
    await user.click(screen.getByRole('button', { name: 'Graduation cap' }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('🎓')
    await openUpload()
    await user.click(screen.getByRole('button', { name: 'settings.general.avatar.reset' }))
    expect(screen.getByRole('status')).toHaveTextContent('🧪')
  })

  it('preserves the last image across oversize/decode errors and accepts retry of the same file', async () => {
    render(<Harness />)
    const { user, input } = await openUpload()
    vi.mocked(checkEntityImageSize).mockReturnValueOnce('too large')
    await user.upload(input, file)
    expect(toast.error).toHaveBeenCalledWith('too large')
    expect(screen.getByRole('status')).toHaveTextContent('🤖')
    vi.mocked(prepareEntityImageBytes).mockRejectedValueOnce(new Error('decode failed'))
    await user.upload(input, file)
    expect(toast.error).toHaveBeenCalledWith('decode failed')
    expect(screen.getByRole('status')).toHaveTextContent('🤖')
    await user.upload(input, file)
    expect(screen.getByRole('status')).toHaveTextContent('image draft')
    const next = await openUpload()
    vi.mocked(prepareEntityImageBytes).mockRejectedValueOnce(new Error('bad replacement'))
    await next.user.upload(next.input, file)
    expect(screen.getByRole('status')).toHaveTextContent('image draft')
  })

  it('discards preparation from a closed session even after the picker is reopened', async () => {
    let finish!: (value: Uint8Array<ArrayBuffer>) => void
    vi.mocked(prepareEntityImageBytes).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const { rerender } = render(<Harness />)
    const { user, input } = await openUpload()
    await user.upload(input, file)
    expect(screen.getByRole('button', { name: label })).toBeDisabled()
    rerender(<Harness active={false} />)
    rerender(<Harness active />)
    await act(async () => finish(bytes))
    expect(screen.getByRole('status')).toHaveTextContent('🤖')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    const next = await openUpload()
    await next.user.upload(next.input, file)
    expect(screen.getByRole('status')).toHaveTextContent('image draft')
  })
})
