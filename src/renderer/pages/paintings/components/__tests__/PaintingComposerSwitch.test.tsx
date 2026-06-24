import type { ComposerSurfaceProps } from '@renderer/components/composer/ComposerSurface'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'

// Unlike PaintingComposer.test.tsx, this suite keeps the REAL ComposerToolRuntime so
// the provider actually owns `files` — the point of the test. The surface is the only
// stand-in: it exposes the provider-owned files count and skips the toolbar
// (renderLeftControls), keeping the model selector / params button and their data
// deps out of scope.
vi.mock('@renderer/components/composer/ComposerSurface', () => ({
  default: (props: ComposerSurfaceProps) => <div data-testid="files-count">{props.filesCount}</div>
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => [key === 'chat.message.font_size' ? 14 : false]
}))

// No matching model → `model` resolves undefined → ComposerToolRuntimeHost (and its
// tool runtimes / DataApi deps) is not rendered, while the real provider + seeding
// hook still drive `files`.
vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: [] })
}))

const { default: PaintingComposer } = await import('../PaintingComposer')

const makeEntry = (id: string): FileEntry =>
  ({ id, name: `${id}.png`, ext: 'png', size: 100, origin: 'internal' }) as unknown as FileEntry

const makePainting = (id: string, inputFiles: FileEntry[], model = 'gpt-image-1'): PaintingData =>
  ({
    id,
    providerId: 'openai',
    model,
    mode: 'generate',
    prompt: '',
    files: [],
    inputFiles
  }) as PaintingData

const handlers = {
  generating: false,
  onPromptChange: vi.fn(),
  onInputFilesChange: vi.fn(),
  onGenerate: vi.fn(),
  onCancel: vi.fn(),
  onModelSelect: vi.fn(),
  onConfigChange: vi.fn(),
  onGenerateRandomSeed: vi.fn()
}

describe('PaintingComposer painting switch', () => {
  beforeEach(() => {
    window.api = {
      ...window.api,
      file: {
        ...window.api.file,
        getPhysicalPath: vi.fn(async ({ id }: { id: string }) => `/p/${id}.png`),
        createInternalEntry: vi.fn(async ({ path }: { path: string }) => makeEntry(path))
      }
    } as typeof window.api
  })

  // The provider key lives on ComposerToolRuntimeProvider (which owns `files`), so a
  // painting switch remounts it and the next painting's inputs fully replace the
  // previous ones — they never accumulate or leak across the boundary. (The subtle
  // in-flight-writeback race the key removes is timing-dependent and not separately
  // asserted; this guards the user-visible contract.)
  it('replaces composer files with the newly selected painting across switches', async () => {
    const filesCount = () => screen.getByTestId('files-count').textContent

    const { rerender } = render(
      <PaintingComposer {...handlers} painting={makePainting('A', [makeEntry('a1'), makeEntry('a2')])} />
    )
    await waitFor(() => expect(filesCount()).toBe('2'))

    rerender(<PaintingComposer {...handlers} painting={makePainting('B', [makeEntry('b1')])} />)
    await waitFor(() => expect(filesCount()).toBe('1'))

    rerender(<PaintingComposer {...handlers} painting={makePainting('C', [])} />)
    await waitFor(() => expect(filesCount()).toBe('0'))
  })

  // switchModel clears inputFiles for a generate-only model on the SAME painting id.
  // The model in the provider key remounts the bridge so the stale chip can't linger
  // (and later be resurrected onto a model that can't accept it).
  it('clears input files when the model switches on the same painting', async () => {
    const filesCount = () => screen.getByTestId('files-count').textContent

    const { rerender } = render(
      <PaintingComposer {...handlers} painting={makePainting('A', [makeEntry('a1')], 'edit-model')} />
    )
    await waitFor(() => expect(filesCount()).toBe('1'))

    rerender(<PaintingComposer {...handlers} painting={makePainting('A', [], 'generate-model')} />)
    await waitFor(() => expect(filesCount()).toBe('0'))
  })
})
