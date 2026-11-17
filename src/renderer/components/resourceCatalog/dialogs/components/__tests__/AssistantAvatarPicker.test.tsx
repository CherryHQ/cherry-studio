import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as Ui from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { checkEntityImageSize, prepareEntityImageBytes } from '@renderer/utils/image'

import { AssistantAvatarPicker } from '../AssistantAvatarPicker'

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
  assistantId: 'assistant-1',
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

describe('AssistantAvatarPicker persistence', () => {
  it('validates and prepares an upload, refreshes projections and reports the saved image', async () => {
    const onChanged = vi.fn()
    render(<AssistantAvatarPicker {...props} onChanged={onChanged} />)
    const user = await openPicker()
    await user.upload(screen.getByLabelText(uploadLabel), file)
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ emoji: '🤖', avatarSrc: 'file:///new.webp' }))
    expect(checkEntityImageSize).toHaveBeenCalledWith(file)
    expect(prepareEntityImageBytes).toHaveBeenCalledWith(file)
    expect(ipcApi.request).toHaveBeenCalledWith('assistant.set_avatar', {
      assistantId: 'assistant-1',
      avatar: { kind: 'image', data: bytes }
    })
    expect(invalidate).toHaveBeenCalledWith(['/assistants/assistant-1', '/assistants'])
    expect(screen.queryByRole('button', { name: 'Reset Avatar' })).not.toBeInTheDocument()
  })

  it('changes the emoji through its own IPC intent', async () => {
    render(<AssistantAvatarPicker {...props} />)
    const user = await openPicker()
    await user.click(screen.getByRole('button', { name: 'Emoji Picker' }))
    await user.click(screen.getByRole('button', { name: 'Graduation cap' }))
    expect(ipcApi.request).toHaveBeenCalledWith('assistant.set_avatar', {
      assistantId: 'assistant-1',
      avatar: { kind: 'emoji', emoji: '🎓' }
    })
  })

  it('resets just the image slot', async () => {
    render(<AssistantAvatarPicker {...props} />)
    const user = await openPicker()
    await user.click(screen.getByRole('button', { name: 'Reset Avatar' }))
    expect(ipcApi.request).toHaveBeenCalledWith('assistant.set_avatar', {
      assistantId: 'assistant-1',
      avatar: { kind: 'default' }
    })
  })

  it('rejects oversized files before processing or persistence', async () => {
    vi.mocked(checkEntityImageSize).mockReturnValue('Too large')
    render(<AssistantAvatarPicker {...props} />)
    const user = await openPicker()
    await user.upload(screen.getByLabelText(uploadLabel), file)
    expect(toast.error).toHaveBeenCalledWith('Too large')
    expect(prepareEntityImageBytes).not.toHaveBeenCalled()
    expect(ipcApi.request).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: 'Avatar' })).toHaveAttribute('src', props.avatarSrc)
  })

  it('keeps the saved avatar and menu on failure so the user can retry', async () => {
    vi.mocked(ipcApi.request).mockRejectedValueOnce(new Error('Upload failed'))
    render(<AssistantAvatarPicker {...props} />)
    const user = await openPicker()
    await user.upload(screen.getByLabelText(uploadLabel), file)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Upload failed'))
    expect(screen.getByRole('img', { name: 'Avatar' })).toHaveAttribute('src', props.avatarSrc)
    expect(screen.getByRole('button', { name: 'Reset Avatar' })).toBeEnabled()
    await user.upload(screen.getByLabelText(uploadLabel), file)
    await waitFor(() => expect(ipcApi.request).toHaveBeenCalledTimes(2))
  })

  it('blocks duplicate operations while preprocessing is pending', async () => {
    let finish!: (data: Uint8Array<ArrayBuffer>) => void
    vi.mocked(prepareEntityImageBytes).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    render(<AssistantAvatarPicker {...props} />)
    const user = await openPicker()
    await user.upload(screen.getByLabelText(uploadLabel), file)
    expect(screen.getByRole('button', { name: 'Reset Avatar' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Reset Avatar' }))
    await act(async () => finish(bytes))
    await waitFor(() => expect(ipcApi.request).toHaveBeenCalledTimes(1))
  })

  it('discards a preprocessed upload after the assistant session changes', async () => {
    let finish!: (data: Uint8Array<ArrayBuffer>) => void
    vi.mocked(prepareEntityImageBytes).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const onChanged = vi.fn()
    const { rerender } = render(<AssistantAvatarPicker {...props} onChanged={onChanged} />)
    const user = await openPicker()
    await user.upload(screen.getByLabelText(uploadLabel), file)
    rerender(<AssistantAvatarPicker {...props} assistantId="assistant-2" onChanged={onChanged} />)
    await user.click(screen.getByRole('button', { name: 'Avatar' }))
    await act(async () => finish(bytes))
    expect(ipcApi.request).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reset Avatar' })).toBeEnabled()
  })

  it('persists a preprocessed upload while its session remains active', async () => {
    let finish!: (data: Uint8Array<ArrayBuffer>) => void
    vi.mocked(prepareEntityImageBytes).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    render(<AssistantAvatarPicker {...props} />)
    const user = await openPicker()
    await user.upload(screen.getByLabelText(uploadLabel), file)
    expect(ipcApi.request).not.toHaveBeenCalled()
    await act(async () => finish(bytes))
    expect(ipcApi.request).toHaveBeenCalledWith('assistant.set_avatar', {
      assistantId: 'assistant-1',
      avatar: { kind: 'image', data: bytes }
    })
    expect(invalidate).toHaveBeenCalledWith(['/assistants/assistant-1', '/assistants'])
    expect(screen.getByRole('button', { name: 'Avatar' })).toBeEnabled()
  })

  it('drops a late completion after unmount', async () => {
    let finish!: () => void
    vi.mocked(ipcApi.request).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    const onChanged = vi.fn()
    const { unmount } = render(<AssistantAvatarPicker {...props} onChanged={onChanged} />)
    const user = await openPicker()
    await user.click(screen.getByRole('button', { name: 'Reset Avatar' }))
    unmount()
    await act(async () => finish())
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('does not let an old assistant completion close the new assistant menu', async () => {
    let finish!: () => void
    vi.mocked(ipcApi.request).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    const onChanged = vi.fn()
    const { rerender } = render(<AssistantAvatarPicker {...props} onChanged={onChanged} />)
    const user = await openPicker()
    await user.click(screen.getByRole('button', { name: 'Reset Avatar' }))
    rerender(<AssistantAvatarPicker {...props} assistantId="assistant-2" onChanged={onChanged} />)
    await user.click(screen.getByRole('button', { name: 'Avatar' }))
    await act(async () => finish())
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reset Avatar' })).toBeVisible()
    expect(ipcApi.request).toHaveBeenCalledWith('assistant.set_avatar', {
      assistantId: 'assistant-1',
      avatar: { kind: 'default' }
    })
  })

  it('falls back to emoji when the saved image cannot decode', () => {
    render(<AssistantAvatarPicker {...props} />)
    fireEvent.error(screen.getByRole('img', { name: 'Avatar' }))
    expect(screen.getByText('🤖')).toBeVisible()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
