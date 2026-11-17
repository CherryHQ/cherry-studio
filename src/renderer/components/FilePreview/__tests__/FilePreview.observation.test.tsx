import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { FileObservationResource } from '@shared/ipc/schemas/fileObservation'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { FilePreview } from '../FilePreview'

const originalApi = window.api

const fixture = vi.hoisted(() => ({
  text: 'first',
  revision: 0,
  listener: undefined as ((event: FileObservationResource) => void) | undefined,
  pending: undefined as Promise<string> | undefined
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: async (route: string) => {
      if (route === 'file.observe.open')
        return { subscriptionId: 'observation', revision: fixture.revision, coverage: 'live' }
      if (route === 'file.observe.activate') return true
      if (route === 'file.observe.close') return
      if (route === 'file.get_metadata') return { kind: 'file', type: 'text', size: 5, modifiedAt: 1 }
      throw new Error(route)
    },
    on: (_event: string, listener: (event: FileObservationResource) => void) => {
      fixture.listener = listener
      return () => {
        fixture.listener = undefined
      }
    }
  }
}))
vi.mock('@renderer/components/FileEditor', () => ({ default: ({ value }: { value: string }) => <pre>{value}</pre> }))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fixture.text = 'first'
  fixture.revision = 0
  fixture.pending = undefined
  vi.stubGlobal('api', {
    ...originalApi,
    fs: { ...originalApi.fs, readText: async () => fixture.pending ?? fixture.text }
  })
})
afterEach(async () => {
  cleanup()
  await vi.runOnlyPendingTimersAsync()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function invalidate(text: string) {
  act(() => {
    fixture.text = text
    fixture.listener?.({ subscriptionId: 'observation', revision: ++fixture.revision, coverage: 'live' })
  })
}

it('refreshes an open preview after equal-length external changes with unchanged metadata and no tree', async () => {
  render(<FilePreview filePath={AbsoluteFilePathSchema.parse('/outside/.hidden.txt')} />)
  expect(await screen.findByText('first')).toBeInTheDocument()
  invalidate('other')
  expect(await screen.findByText('other')).toBeInTheDocument()
  expect(screen.queryByText('first')).not.toBeInTheDocument()
})

it('rejects a superseded content read when another invalidation arrives during loading', async () => {
  render(<FilePreview filePath={AbsoluteFilePathSchema.parse('/outside/second.txt')} />)
  expect(await screen.findByText('first')).toBeInTheDocument()
  const old = Promise.withResolvers<string>()
  fixture.pending = old.promise
  invalidate('older')
  await act(async () => {
    await Promise.resolve()
  })
  fixture.pending = undefined
  invalidate('latest')
  expect(await screen.findByText('latest')).toBeInTheDocument()
  await act(async () => old.resolve('older'))
  expect(screen.queryByText('older')).not.toBeInTheDocument()
  expect(screen.getByText('latest')).toBeInTheDocument()
})

it('reloads media plugins after an external invalidation even when the caller refresh key is unchanged', async () => {
  render(<FilePreview filePath={AbsoluteFilePathSchema.parse('/outside/clip.mp4')} />)
  const video = await screen.findByLabelText('clip.mp4')
  fireEvent.error(video)
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  invalidate('other')
  expect(await screen.findByLabelText('clip.mp4')).not.toBe(video)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
