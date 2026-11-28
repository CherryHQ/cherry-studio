import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getToastUtilities } from '@cherrystudio/ui'
import ToastHost from '@renderer/components/ToastHost'

// The shared setup stubs Dropzone and the toast service; this test needs the real rejection and toast paths.
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.unmock('@renderer/services/toast')

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { ImageUploader } from '../ImageUploader'

function dropFiles(files: File[]) {
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error('file input not rendered')
  fireEvent.change(input, { target: { files } })
}

function renderUploader() {
  render(
    <>
      <ImageUploader visible onImageSelect={vi.fn()} onClose={vi.fn()} />
      <ToastHost />
    </>
  )
}

describe('ImageUploader rejections', () => {
  beforeEach(() => {
    act(() => {
      getToastUtilities().closeAll()
    })
  })

  // Dropping two images is not a type problem; "Please select an image file" would mislead.
  it('explains a multi-file drop as too many files, not an invalid type', async () => {
    renderUploader()
    dropFiles([new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })])

    expect(await screen.findByText('richEditor.imageUploader.tooManyFiles')).toBeInTheDocument()
    expect(screen.queryByText('richEditor.imageUploader.invalidType')).not.toBeInTheDocument()
  })

  // A wrong file type is user input, not a fault; it must not offer an error-details entry.
  it('rejects a non-image with a toast that has no details action', async () => {
    renderUploader()
    dropFiles([new File(['a'], 'a.txt', { type: 'text/plain' })])

    expect(await screen.findByText('richEditor.imageUploader.invalidType')).toBeInTheDocument()
    // The open dialog marks the toast viewport aria-hidden.
    expect(screen.queryByRole('button', { name: 'common.detail', hidden: true })).not.toBeInTheDocument()
  })
})
