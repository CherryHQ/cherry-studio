import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fileErrorCodes } from '@shared/ipc/errors/file'
import type { AbsoluteFilePath } from '@shared/types/file'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { application } = await import('@application')
const { resolveRequestedPath } = await import('../requestedPath')

const HOME = '/home/alice'
const WORKSPACE = '/home/alice/project' as AbsoluteFilePath

function expectRejected(rawPath: string, reason: 'relative' | 'invalid', workspaceRoot?: AbsoluteFilePath): void {
  try {
    resolveRequestedPath(rawPath, workspaceRoot)
    throw new Error(`expected ${JSON.stringify(rawPath)} to be rejected`)
  } catch (error) {
    expect(error).toMatchObject({
      code: fileErrorCodes.OPEN_TARGET_UNAVAILABLE,
      data: { path: rawPath, reason }
    })
  }
}

describe('resolveRequestedPath', () => {
  beforeEach(() => {
    vi.spyOn(application, 'getPath').mockImplementation((key: string) => {
      if (key === 'sys.home') return HOME
      throw new Error(`Unexpected application.getPath(${key})`)
    })
  })

  it('resolves a workspace-relative path against the session workspace', () => {
    expect(resolveRequestedPath('assets/logo.png', WORKSPACE)).toBe('/home/alice/project/assets/logo.png')
  })

  it('leaves an already-absolute path alone even when a workspace root is given', () => {
    expect(resolveRequestedPath('/opt/output/logo.png', WORKSPACE)).toBe('/opt/output/logo.png')
  })

  it('expands a home-relative path', () => {
    expect(resolveRequestedPath('~/notes/draft.md')).toBe('/home/alice/notes/draft.md')
  })

  it('allows an escape above the workspace root, which agents legitimately produce', () => {
    expect(resolveRequestedPath('../shared/logo.png', WORKSPACE)).toBe('/home/alice/shared/logo.png')
  })

  it('refuses a relative path when no workspace root is available', () => {
    expectRejected('assets/logo.png', 'relative')
  })

  it('refuses a relative path whose root is itself not absolute', () => {
    expectRejected('assets/logo.png', 'relative', 'project' as AbsoluteFilePath)
  })

  it.each(['', '   '])('refuses an empty path %j', (rawPath) => {
    expectRejected(rawPath, 'invalid', WORKSPACE)
  })
})
