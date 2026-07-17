import { describe, expect, it, vi } from 'vitest'

import { openFileTarget } from '../shared/openFileTarget'

describe('openFileTarget', () => {
  it('opens a file in the artifact preview pane', async () => {
    const openArtifactFile = vi.fn()
    const openPath = vi.fn()
    const isDirectory = vi.fn().mockResolvedValue(false)

    await openFileTarget('/ws/a.md', { openArtifactFile, openPath, isDirectory })

    expect(isDirectory).toHaveBeenCalledWith('/ws/a.md')
    expect(openArtifactFile).toHaveBeenCalledWith('/ws/a.md')
    expect(openPath).not.toHaveBeenCalled()
  })

  it('opens a directory in the system file manager instead of the preview pane', async () => {
    const openArtifactFile = vi.fn()
    const openPath = vi.fn()
    const isDirectory = vi.fn().mockResolvedValue(true)

    await openFileTarget('/ws/src', { openArtifactFile, openPath, isDirectory })

    expect(openPath).toHaveBeenCalledWith('/ws/src')
    expect(openArtifactFile).not.toHaveBeenCalled()
  })

  it('routes everything through openPath when no preview pane is wired', async () => {
    const openPath = vi.fn()

    await openFileTarget('/ws/a.md', { openPath, isDirectory: vi.fn().mockResolvedValue(false) })

    expect(openPath).toHaveBeenCalledWith('/ws/a.md')
  })

  it('treats a missing isDirectory check as a file', async () => {
    const openArtifactFile = vi.fn()

    await openFileTarget('/ws/a.md', { openArtifactFile })

    expect(openArtifactFile).toHaveBeenCalledWith('/ws/a.md')
  })

  it('invokes onError and never rejects when opening throws', async () => {
    const onError = vi.fn()
    const openArtifactFile = vi.fn().mockRejectedValue(new Error('boom'))

    await expect(
      openFileTarget('/ws/a.md', { openArtifactFile, isDirectory: vi.fn().mockResolvedValue(false), onError })
    ).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
