import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { FileEntry } from '@shared/data/types/file'

import { usePaintingComposerInputFiles } from '../../hooks/usePaintingComposerInputFiles'
import { PaintingImageAddButton } from '../PaintingImageGallery'

const runtime = vi.hoisted(() => ({ files: [] as ComposerAttachment[], setFiles: vi.fn() }))
vi.mock('@renderer/components/composer/ComposerToolRuntime', () => ({
  useComposerToolState: () => ({ files: runtime.files, extensions: ['.png'] }),
  useComposerToolDispatch: () => ({ setFiles: runtime.setFiles })
}))

it('imports a result URL, resolves its local path and materializes a real reference entry', async () => {
  await i18n.changeLanguage('en-US')
  const entry = {
    id: 'download',
    name: 'result',
    ext: 'png',
    size: 100,
    origin: 'internal',
    createdAt: Date.now()
  } as unknown as FileEntry
  const imported = { ...entry, id: 'reference' }
  const createInternalEntry = vi.fn().mockResolvedValueOnce(entry).mockResolvedValueOnce(imported)
  const getPhysicalPath = vi.fn().mockResolvedValue('/cache/download.png')
  Object.assign(window, { api: { ...window.api, file: { ...window.api.file, createInternalEntry, getPhysicalPath } } })
  let materialize!: ReturnType<typeof usePaintingComposerInputFiles>['materializeInputs']
  function Harness() {
    const [files, setFiles] = useState<ComposerAttachment[]>([])
    runtime.files = files
    runtime.setFiles = setFiles as typeof runtime.setFiles
    materialize = usePaintingComposerInputFiles({
      paintingId: 'url',
      inputFiles: [],
      files,
      setFiles,
      inputCapability: 'accept',
      providerId: 'doubao'
    }).materializeInputs
    return <PaintingImageAddButton />
  }
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Add from URL' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Add from URL' }), {
    target: { value: 'https://example.com/result.png' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(runtime.files).toHaveLength(1))
  expect(createInternalEntry).toHaveBeenNthCalledWith(1, {
    source: 'url',
    url: 'https://example.com/result.png',
    cleanupPolicy: 'delete_when_unreferenced'
  })
  expect(runtime.files[0].path).toBe('/cache/download.png')
  let result: Awaited<ReturnType<typeof materialize>> | undefined
  await act(async () => {
    result = await materialize()
  })
  expect(result).toEqual({ entries: [imported], complete: true })
  expect(createInternalEntry).toHaveBeenNthCalledWith(2, {
    source: 'path',
    path: '/cache/download.png',
    cleanupPolicy: 'delete_when_unreferenced'
  })
})
