import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as Ui from '@cherrystudio/ui'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { checkEntityImageSize, prepareEntityImageBytes } from '@renderer/utils/image'

import { AgentAvatarPicker } from '../AgentAvatarPicker'

vi.mock('@cherrystudio/ui', async (original) => original<typeof Ui>())
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'settings.general.image_upload': 'Image Upload',
          'settings.general.emoji_picker': 'Emoji Picker',
          'settings.general.avatar.reset': 'Reset Avatar'
        }) as Record<string, string>
      )[key] ?? key
  })
}))
vi.mock('@renderer/utils/image', () => ({ checkEntityImageSize: vi.fn(), prepareEntityImageBytes: vi.fn() }))
vi.mock('@renderer/components/EmojiPicker', () => ({
  EmojiPicker: ({ onEmojiClick }: { onEmojiClick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onEmojiClick('🎓')}>
      Graduation cap
    </button>
  )
}))
const invalidate = vi.hoisted(() => vi.fn())
vi.mock('@renderer/data/hooks/useDataApi', () => ({ useInvalidateCache: () => invalidate }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

const props = {
  agentId: 'agent-1',
  emoji: '🤖',
  avatarSrc: 'file:///saved.webp',
  ariaLabel: 'Avatar',
  portalContainer: null
}
const file = new File(['image'], 'avatar.png', { type: 'image/png' })
const bytes = new Uint8Array([1, 2, 3])
const uploadLabel = 'Image Upload'

beforeEach(() => {
  vi.mocked(ipcApi.request).mockReset().mockResolvedValue(undefined)
  vi.mocked(checkEntityImageSize).mockReset().mockReturnValue(null)
  vi.mocked(prepareEntityImageBytes).mockReset().mockResolvedValue(bytes)
  invalidate.mockReset().mockResolvedValue(undefined)
  vi.mocked(dataApiService.get).mockResolvedValue({ emoji: '🤖', avatarSrc: 'file:///new.webp' })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function openPicker() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Avatar' }))
  return user
}

describe('AgentAvatarPicker persistence', () => {
  it('applies an image selected after the avatar popover is dismissed', async () => {
    function Harness() {
      const [avatar, setAvatar] = useState<{ avatarSrc?: string; emoji: string }>({
        avatarSrc: props.avatarSrc,
        emoji: props.emoji
      })
      return (
        <>
          <InputGroup>
            <InputGroupAddon>
              <AgentAvatarPicker {...props} {...avatar} onChanged={setAvatar} />
            </InputGroupAddon>
            <InputGroupInput aria-label="Agent name" defaultValue="Agent" />
          </InputGroup>
          <button type="button" onClick={() => setAvatar({ avatarSrc: props.avatarSrc, emoji: props.emoji })}>
            Restore preview
          </button>
        </>
      )
    }
    render(<Harness />)
    const user = await openPicker()
    await user.click(screen.getByRole('button', { name: uploadLabel }))
    expect(screen.getByRole('textbox', { name: 'Agent name' })).not.toHaveFocus()
    expect(screen.getByLabelText(uploadLabel)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(uploadLabel), { target: { files: [file] } })
    await waitFor(() => {
      expect(ipcApi.request).toHaveBeenCalledExactlyOnceWith('agent.set_avatar', {
        agentId: 'agent-1',
        avatar: { kind: 'image', data: bytes }
      })
      expect(screen.getByRole('img', { name: 'Avatar' })).toHaveAttribute('src', 'file:///new.webp')
    })

    await user.click(screen.getByRole('button', { name: 'Restore preview' }))
    expect(screen.getByRole('img', { name: 'Avatar' })).toHaveAttribute('src', props.avatarSrc)
    await user.click(screen.getByRole('button', { name: 'Avatar' }))
    await user.click(screen.getByRole('button', { name: uploadLabel }))
    const input = screen.getByLabelText(uploadLabel)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('button', { name: uploadLabel })).not.toBeInTheDocument())

    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      expect({
        requests: vi.mocked(ipcApi.request).mock.calls.length,
        preview: screen.getByRole('img', { name: 'Avatar' }).getAttribute('src')
      }).toEqual({ requests: 2, preview: 'file:///new.webp' })
      expect(ipcApi.request).toHaveBeenNthCalledWith(2, 'agent.set_avatar', {
        agentId: 'agent-1',
        avatar: { kind: 'image', data: bytes }
      })
    })
  })

  it('resets the agent avatar from the menu', async () => {
    render(<AgentAvatarPicker {...props} />)
    const user = await openPicker()
    await user.click(screen.getByRole('button', { name: 'Reset Avatar' }))
    expect(ipcApi.request).toHaveBeenCalledWith('agent.set_avatar', {
      agentId: 'agent-1',
      avatar: { kind: 'default' }
    })
  })

  it('discards a preprocessed upload after the assistant session changes', async () => {
    let finish!: (data: Uint8Array<ArrayBuffer>) => void
    vi.mocked(prepareEntityImageBytes).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const onChanged = vi.fn()
    const { rerender } = render(<AgentAvatarPicker {...props} onChanged={onChanged} />)
    const user = await openPicker()
    await user.upload(screen.getByLabelText(uploadLabel), file)
    rerender(<AgentAvatarPicker {...props} agentId="agent-2" onChanged={onChanged} />)
    await user.click(screen.getByRole('button', { name: 'Avatar' }))
    await act(async () => finish(bytes))
    expect(ipcApi.request).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reset Avatar' })).toBeEnabled()
  })
})
