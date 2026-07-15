import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

vi.mock('@renderer/components/ImageViewer', () => ({
  default: ({ src, alt }: { src: string; alt?: string }) => <img src={src} alt={alt} />
}))

const state: { files: any[]; extensions: string[] } = { files: [], extensions: ['.png', '.jpg'] }
const setFiles = vi.fn()

vi.mock('@renderer/components/composer/ComposerToolRuntime', () => ({
  useComposerToolState: () => state,
  useComposerToolDispatch: () => ({ setFiles })
}))

vi.mock('@shared/utils/file', () => ({ toSafeFileUrl: (path: string) => `safe://${path}` }))

vi.mock('@renderer/utils/message/composerAttachment', () => ({
  toComposerAttachments: (metas: { path: string; name: string }[]) =>
    metas.map((m) => ({
      fileTokenSourceId: m.path,
      path: m.path,
      name: m.name,
      origin_name: m.name,
      ext: '.png',
      size: 0,
      type: 'image'
    }))
}))

const { PaintingImageGallery } = await import('../PaintingImageGallery')

const makeFile = (id: string) => ({
  fileTokenSourceId: id,
  path: `/tmp/${id}.png`,
  name: `${id}.png`,
  origin_name: `${id}.png`,
  ext: '.png',
  size: 1,
  type: 'image'
})

const mockSelect = vi.fn()

beforeEach(() => {
  state.files = []
  state.extensions = ['.png', '.jpg']
  setFiles.mockReset()
  mockSelect.mockReset()
  Object.defineProperty(window, 'api', { value: { file: { select: mockSelect } }, configurable: true })
})

describe('PaintingImageGallery', () => {
  it('renders one preview tile per image plus the add tile', () => {
    state.files = [makeFile('a'), makeFile('b')]
    render(<PaintingImageGallery />)

    expect(screen.getAllByRole('img')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'paintings.add_image' })).toBeInTheDocument()
  })

  it('appends picked images to files when the add tile is clicked', async () => {
    mockSelect.mockResolvedValue([{ path: '/tmp/c.png', name: 'c.png' }])
    render(<PaintingImageGallery />)

    fireEvent.click(screen.getByRole('button', { name: 'paintings.add_image' }))

    await waitFor(() => expect(setFiles).toHaveBeenCalled())
    // The picker filters to the composer's image extensions (leading dot stripped).
    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [expect.objectContaining({ extensions: ['png', 'jpg'] })] })
    )
    const updater = setFiles.mock.calls[0][0]
    expect(updater([makeFile('a')])).toEqual([
      makeFile('a'),
      expect.objectContaining({ fileTokenSourceId: '/tmp/c.png' })
    ])
  })

  it('removes an image by fileTokenSourceId when its × is clicked', () => {
    state.files = [makeFile('a'), makeFile('b')]
    render(<PaintingImageGallery />)

    fireEvent.click(screen.getAllByRole('button', { name: 'common.delete' })[0])

    expect(setFiles).toHaveBeenCalledTimes(1)
    const updater = setFiles.mock.calls[0][0]
    expect(updater([makeFile('a'), makeFile('b')])).toEqual([makeFile('b')])
  })
})
