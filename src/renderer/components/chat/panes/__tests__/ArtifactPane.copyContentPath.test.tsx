import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandContextKeyProvider, CommandProvider } from '@renderer/components/command'
import i18n from '@renderer/i18n/resolver'

import { ARTIFACT_PREVIEW_MAX_SIZE_BYTES, ArtifactPaneView } from '../ArtifactPane'
import type { ArtifactFileTreeModel } from '../useArtifactFileTreeModel'

const BS = String.fromCharCode(0x5c)
const OVERSIZED = ARTIFACT_PREVIEW_MAX_SIZE_BYTES + 1

vi.mock('@renderer/components/FilePreview', () => ({
  FilePreview: () => <div data-testid="file-preview" />,
  FilePreviewModeToolbarPortalHost: () => null,
  FilePreviewModeToolbarPortalProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/components/FileTree', () => ({
  FileTree: () => <div data-testid="file-tree" />
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: null }),
  useCmTheme: () => null
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

vi.mock('@renderer/components/OpenTarget', () => ({
  OpenTargetButton: () => null,
  loadOpenTargetMenuItems: async () => []
}))

type Meta = { kind: 'file'; type: 'text'; size: number; createdAt: number; modifiedAt: number; mime: string }
type Envelope = { ok: true; data: Meta | null }

function textFile(size: number): Meta {
  return { kind: 'file', type: 'text', size, createdAt: 1, modifiedAt: 1, mime: 'text/plain' }
}

function requestMock() {
  return window.api.ipcApi.request as unknown as {
    mockImplementation(fn: (route: string, input?: { path?: string }) => Promise<Envelope>): void
    mockReset(): void
    mockResolvedValue(value: unknown): void
  }
}

function defer<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function installMetadata(files: Map<string, Meta>) {
  const pending: Array<{ path: string; resolve: (value: Envelope) => void; promise: Promise<Envelope> }> = []
  requestMock().mockImplementation((route, input) => {
    if (route !== 'file.get_metadata') return Promise.resolve({ ok: true, data: null })
    const gate = defer<Envelope>()
    pending.push({ path: input?.path ?? '', resolve: gate.resolve, promise: gate.promise })
    return gate.promise
  })
  return {
    pending,
    settle: () =>
      act(async () => {
        for (const gate of pending) gate.resolve({ ok: true, data: files.get(gate.path) ?? null })
        await Promise.all(pending.map((gate) => gate.promise))
      })
  }
}

function model(): ArtifactFileTreeModel {
  return {
    nodes: [],
    nodeById: {},
    expandedIds: new Set(),
    errorKind: undefined,
    onExpandedChange: vi.fn(),
    refresh: vi.fn(),
    reloadExpandedDirectories: vi.fn(),
    expandDirectory: vi.fn(),
    collapseDirectory: vi.fn()
  } as unknown as ArtifactFileTreeModel
}

function renderPreview(workspacePath: string, filePath: string) {
  return render(
    <CommandContextKeyProvider>
      <CommandProvider>
        <ArtifactPaneView
          headerVariant="pane"
          paneTitle="Files"
          paneActions={null}
          workspacePath={workspacePath}
          selectedFile={null}
          onSelectedFileChange={vi.fn()}
          previewFileSelection={{ workspacePath, filePath }}
          model={model()}
          searchKeyword=""
          onSearchKeywordChange={vi.fn()}
        />
      </CommandProvider>
    </CommandContextKeyProvider>
  )
}

describe('ArtifactPane Copy Content uses the selected file', () => {
  const clipboard = { value: '' }
  let originalLanguage = i18n.language

  beforeEach(async () => {
    originalLanguage = i18n.language
    clipboard.value = ''
    await i18n.changeLanguage('en-US')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          clipboard.value = value
        },
        readText: async () => clipboard.value
      }
    })
  })

  afterEach(async () => {
    cleanup()
    const request = requestMock()
    request.mockReset()
    request.mockResolvedValue(undefined)
    await i18n.changeLanguage(originalLanguage)
  })

  // A 4-byte sibling must not turn on Copy Content for a file past the 2 MiB cap.
  it.each([
    {
      name: 'basename begins with a backslash',
      workspacePath: '/fixtures/lead',
      filePath: `${BS}large.txt`,
      selected: `/fixtures/lead/${BS}large.txt`,
      sibling: '/fixtures/lead/large.txt'
    },
    {
      name: 'workspace directory ends with a backslash',
      workspacePath: `/fixtures/trail/ws${BS}`,
      filePath: 'large.txt',
      selected: `/fixtures/trail/ws${BS}/large.txt`,
      sibling: `/fixtures/trail/ws${BS}large.txt`
    }
  ])('$name withholds Copy Content for the oversized selected file', async (scenario) => {
    const metadata = installMetadata(
      new Map([
        [scenario.sibling, textFile(4)],
        [scenario.selected, textFile(OVERSIZED)]
      ])
    )
    renderPreview(scenario.workspacePath, scenario.filePath)
    await waitFor(() => expect(metadata.pending.length).toBeGreaterThan(0))
    await metadata.settle()
    expect(screen.queryByRole('button', { name: 'Copy Content' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy Path' })).toBeInTheDocument()
  })

  // A missing sibling must not hide Copy Content for a small selected text file.
  it.each([
    {
      name: 'basename begins with a backslash',
      workspacePath: '/fixtures/lead',
      filePath: `${BS}small.txt`,
      selected: `/fixtures/lead/${BS}small.txt`,
      sibling: '/fixtures/lead/small.txt'
    },
    {
      name: 'workspace directory ends with a backslash',
      workspacePath: `/fixtures/trail/ws${BS}`,
      filePath: 'small.txt',
      selected: `/fixtures/trail/ws${BS}/small.txt`,
      sibling: `/fixtures/trail/ws${BS}small.txt`
    }
  ])('$name copies the small selected file when its sibling is missing', async (scenario) => {
    const selectedContent = `selected-body:${scenario.selected}`
    const siblingContent = `sibling-body:${scenario.sibling}`
    const api = window.api as typeof window.api & { fs?: { readText?: (path: string) => Promise<string> } }
    api.fs = {
      ...api.fs,
      readText: async (path: string) => {
        if (path === scenario.selected) return selectedContent
        if (path === scenario.sibling) return siblingContent
        throw new Error(`unexpected read ${path}`)
      }
    }
    const metadata = installMetadata(new Map([[scenario.selected, textFile(8)]]))
    renderPreview(scenario.workspacePath, scenario.filePath)
    await waitFor(() => expect(metadata.pending.length).toBeGreaterThan(0))
    await metadata.settle()
    fireEvent.click(await screen.findByRole('button', { name: 'Copy Content' }))
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(selectedContent))
  })
})
