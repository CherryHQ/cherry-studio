import { resetToastMocks } from '@test-mocks/renderer/toast'
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

// The shared setup stubs Dropzone; this test needs the real rejection path.
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { ImageUploader } from '../ImageUploader'

function dropFiles(files: File[]) {
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error('file input not rendered')
  fireEvent.change(input, { target: { files } })
}

describe('ImageUploader rejections', () => {
  beforeEach(() => resetToastMocks())

  // Dropping two images is not a type problem; "Please select an image file" would mislead.
  it('explains a multi-file drop as too many files, not an invalid type', async () => {
    render(<ImageUploader visible onImageSelect={vi.fn()} onClose={vi.fn()} />)
    dropFiles([new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })])

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.error).toHaveBeenCalledWith('richEditor.imageUploader.tooManyFiles')
    expect(toast.error).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'richEditor.imageUploader.invalidType' })
    )
  })
})
