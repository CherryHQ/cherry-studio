import { fireEvent, render, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

import { ImageUploader } from '../ImageUploader'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

function dropFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

describe('ImageUploader drop validation', () => {
  afterEach(async () => {
    await i18next.changeLanguage('en-US')
  })

  it('tells a French user that a valid image is too large, not that it is the wrong type', async () => {
    await i18next.changeLanguage('fr-FR')
    render(<ImageUploader visible onImageSelect={vi.fn()} onClose={vi.fn()} />)
    const oversized = new File(['x'], 'photo.png', { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 })

    dropFile(oversized)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(i18next.t('richEditor.imageUploader.tooLarge')))
  })

  it('still rejects a non-image file as the wrong type', async () => {
    await i18next.changeLanguage('fr-FR')
    render(<ImageUploader visible onImageSelect={vi.fn()} onClose={vi.fn()} />)

    dropFile(new File(['x'], 'notes.txt', { type: 'text/plain' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(i18next.t('richEditor.imageUploader.invalidType')))
  })
})
