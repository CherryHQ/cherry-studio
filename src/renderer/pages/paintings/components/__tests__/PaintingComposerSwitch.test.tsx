import type { ComposerSurfaceProps } from '@renderer/components/composer/ComposerSurface'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerDraft } from '../../model/composerDraft'

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

const makeDraft = (sessionId: string, inputFiles: FileEntry[], model = 'gpt-image-1'): ComposerDraft => ({
  sessionId,
  providerId: 'openai',
  model,
  mode: 'generate',
  prompt: '',
  params: {},
  inputFiles
})

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

describe('PaintingComposer draft switch', () => {
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

  // The provider key lives on ComposerToolRuntimeProvider (which owns `files`) and is
  // keyed by `draft.sessionId`. Replacing the draft (new session) remounts it, so the
  // next draft's inputs fully replace the previous ones — they never accumulate or
  // leak across the boundary.
  it('replaces composer files when the draft session changes', async () => {
    const filesCount = () => screen.getByTestId('files-count').textContent

    const { rerender } = render(
      <PaintingComposer {...handlers} draft={makeDraft('A', [makeEntry('a1'), makeEntry('a2')])} />
    )
    await waitFor(() => expect(filesCount()).toBe('2'))

    rerender(<PaintingComposer {...handlers} draft={makeDraft('B', [makeEntry('b1')])} />)
    await waitFor(() => expect(filesCount()).toBe('1'))

    rerender(<PaintingComposer {...handlers} draft={makeDraft('C', [])} />)
    await waitFor(() => expect(filesCount()).toBe('0'))
  })

  // The decoupling contract (the bug PR1.5 fixes): switching the MODEL keeps the same
  // sessionId, so the runtime provider does NOT remount and the attached input images
  // survive — even though the new draft's inputFiles prop is empty. Before the
  // refactor, the model lived in the provider key and a model switch wiped the chips.
  it('keeps input files when only the model changes (same session)', async () => {
    const filesCount = () => screen.getByTestId('files-count').textContent

    const { rerender } = render(
      <PaintingComposer {...handlers} draft={makeDraft('A', [makeEntry('a1')], 'edit-model')} />
    )
    await waitFor(() => expect(filesCount()).toBe('1'))

    rerender(<PaintingComposer {...handlers} draft={makeDraft('A', [], 'generate-model')} />)
    // Same session → no remount/re-seed → the composer keeps its files. Give async
    // seed/writeback effects a chance to (wrongly) fire before asserting persistence.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(filesCount()).toBe('1')
  })
})
