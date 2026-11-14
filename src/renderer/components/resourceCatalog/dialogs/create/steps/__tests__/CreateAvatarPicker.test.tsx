import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm, useFormState, useWatch } from 'react-hook-form'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as Ui from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'
import type * as ImageUtils from '@renderer/utils/image'
import { checkEntityImageSize, prepareEntityImageBytes } from '@renderer/utils/image'

import type { ResourceCreateWizardFormValues } from '../../types'
import { CreateAvatarPicker } from '../CreateAvatarPicker'

vi.mock('@cherrystudio/ui', async (original) => original<typeof Ui>())
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'library.config.dialogs.create.avatar_aria': 'Choose avatar',
          'library.config.dialogs.create.avatar_upload': 'Upload',
          'library.config.dialogs.create.avatar_remove_image': 'Remove image'
        }) as Record<string, string>
      )[key] ?? key
  })
}))
// Canvas decoding is unavailable in jsdom; the real data-URL encoding still runs.
vi.mock('@renderer/utils/image', async (original) => ({
  ...(await original<typeof ImageUtils>()),
  checkEntityImageSize: vi.fn(),
  prepareEntityImageBytes: vi.fn()
}))
vi.mock('@renderer/components/EmojiPicker', () => ({
  EmojiPicker: ({ onEmojiClick }: { onEmojiClick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onEmojiClick('🎓')}>
      Graduation cap
    </button>
  )
}))

const file = new File(['image'], 'avatar.png', { type: 'image/png' })
const bytes = new Uint8Array([1, 2, 3])

function Harness() {
  const form = useForm<ResourceCreateWizardFormValues>({
    defaultValues: { avatar: '✨', avatarImage: null }
  })
  const [avatar, avatarImage] = useWatch({ control: form.control, name: ['avatar', 'avatarImage'] })
  const { dirtyFields } = useFormState({ control: form.control })
  return (
    <>
      <CreateAvatarPicker form={form} fallbackAvatar="✨" portalContainer={null} />
      <output data-testid="avatar">{avatar}</output>
      <output data-testid="image-bytes">{avatarImage ? Array.from(avatarImage.data).join(',') : 'none'}</output>
      <output data-testid="image-dirty">{String(Boolean(dirtyFields.avatarImage))}</output>
    </>
  )
}

const trigger = () => screen.getByRole('button', { name: 'Choose avatar' })

async function upload(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger())
  await user.upload(screen.getByLabelText('Upload', { selector: 'input' }), file)
}

beforeEach(() => {
  vi.mocked(checkEntityImageSize).mockReset().mockReturnValue(null)
  vi.mocked(prepareEntityImageBytes).mockReset().mockResolvedValue(bytes)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CreateAvatarPicker', () => {
  it('keeps a prepared upload as a dirty draft and shows it on the avatar', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await upload(user)

    await waitFor(() => expect(screen.getByTestId('image-bytes')).toHaveTextContent('1,2,3'))
    expect(prepareEntityImageBytes).toHaveBeenCalledWith(file)
    expect(screen.getByTestId('image-dirty')).toHaveTextContent('true')
    expect(screen.getByRole('img', { name: 'Choose avatar' })).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/webp;base64,/)
    )
  })

  it('drops the uploaded image when an emoji is picked or the avatar is reset', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await upload(user)
    await waitFor(() => expect(screen.getByTestId('image-bytes')).toHaveTextContent('1,2,3'))
    await user.click(trigger())
    await user.click(screen.getByRole('button', { name: 'Remove image' }))
    expect(screen.getByTestId('image-bytes')).toHaveTextContent('none')
    expect(screen.queryByRole('img', { name: 'Choose avatar' })).not.toBeInTheDocument()

    await upload(user)
    await waitFor(() => expect(screen.getByTestId('image-bytes')).toHaveTextContent('1,2,3'))
    await user.click(trigger())
    await user.click(screen.getByRole('button', { name: 'Graduation cap' }))
    expect(screen.getByTestId('image-bytes')).toHaveTextContent('none')
    expect(screen.getByTestId('avatar')).toHaveTextContent('🎓')
  })

  it('keeps the emoji and reports why when the image cannot be prepared', async () => {
    vi.mocked(prepareEntityImageBytes).mockRejectedValue(new Error('Image could not be processed'))
    const user = userEvent.setup()
    render(<Harness />)

    await upload(user)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Image could not be processed'))
    expect(screen.getByTestId('image-bytes')).toHaveTextContent('none')
    expect(screen.getByLabelText('Upload', { selector: 'input' })).toBeEnabled()
  })
})
