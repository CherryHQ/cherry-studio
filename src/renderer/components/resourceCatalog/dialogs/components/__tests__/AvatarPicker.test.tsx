import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as Ui from '@cherrystudio/ui'

import { AvatarPicker } from '../AvatarPicker'

vi.mock('@cherrystudio/ui', async (original) => original<typeof Ui>())
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'library.config.dialogs.create.avatar_random': 'Random avatar',
          'library.config.dialogs.create.avatar_upload': 'Upload image'
        }) as Record<string, string>
      )[key] ?? key
  })
}))
vi.mock('@renderer/components/EmojiPicker', () => ({
  EmojiPicker: ({ onEmojiClick }: { onEmojiClick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onEmojiClick('🎓')}>
      Graduation cap
    </button>
  )
}))

type Callbacks = Pick<ComponentProps<typeof AvatarPicker>, 'onEmojiChange' | 'onUpload' | 'onReset'>

/** Holds the emoji like a real caller, so each 🎲 roll starts from the last one. */
function Host(callbacks: Callbacks) {
  const [open, setOpen] = useState(false)
  const [emoji, setEmoji] = useState('🦊')
  return (
    <AvatarPicker
      {...callbacks}
      emoji={emoji}
      onEmojiChange={(next) => {
        setEmoji(next)
        callbacks.onEmojiChange(next)
      }}
      open={open}
      onOpenChange={setOpen}
      ariaLabel="Choose avatar"
      portalContainer={null}
    />
  )
}

function renderHost() {
  const callbacks = { onEmojiChange: vi.fn(), onUpload: vi.fn(), onReset: vi.fn() }
  render(<Host {...callbacks} />)
  return callbacks
}

afterEach(() => {
  cleanup()
})

describe('AvatarPicker', () => {
  it('rolls a different emoji on every 🎲 and stays open for another roll', async () => {
    const user = userEvent.setup()
    const { onEmojiChange } = renderHost()
    await user.click(screen.getByRole('button', { name: 'Choose avatar' }))

    for (let i = 0; i < 20; i++) await user.click(screen.getByRole('button', { name: 'Random avatar' }))

    expect(onEmojiChange).toHaveBeenCalledTimes(20)
    let previous = '🦊'
    for (const [emoji] of onEmojiChange.mock.calls) {
      expect(emoji).not.toBe(previous)
      expect(emoji).toMatch(/\p{Extended_Pictographic}/u)
      previous = emoji
    }
    expect(screen.getByRole('button', { name: 'Random avatar' })).toBeVisible()
  })

  it('uploads from the header and closes on an emoji pick', async () => {
    const user = userEvent.setup()
    const { onEmojiChange, onUpload } = renderHost()
    const file = new File(['image'], 'avatar.png', { type: 'image/png' })
    await user.click(screen.getByRole('button', { name: 'Choose avatar' }))

    const input = screen.getByLabelText('Upload image', { selector: 'input' })
    const openFileDialog = vi.spyOn(input, 'click')
    await user.click(screen.getByRole('button', { name: 'Upload image' }))
    expect(openFileDialog).toHaveBeenCalledOnce()
    await user.upload(input, file)
    expect(onUpload).toHaveBeenCalledWith(file)

    await user.click(screen.getByRole('button', { name: 'Graduation cap' }))
    expect(onEmojiChange).toHaveBeenCalledWith('🎓')
    expect(screen.queryByRole('button', { name: 'Upload image' })).not.toBeInTheDocument()
  })
})
