import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AbsoluteFilePathSchema } from '@shared/types/file'

const { ipcApiRequest } = vi.hoisted(() => ({
  ipcApiRequest: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcApiRequest }
}))

import { copyAttachmentToWorkspace } from '../copyAttachmentToWorkspace'

const tmpReport = AbsoluteFilePathSchema.parse('/tmp/report.md')
const workspaceRoot = AbsoluteFilePathSchema.parse('/workspace')
const tmpAReport = AbsoluteFilePathSchema.parse('/tmp/a/report.md')
const tmpBReport = AbsoluteFilePathSchema.parse('/tmp/b/report.md')
const uncWorkspace = AbsoluteFilePathSchema.parse('\\\\server\\share\\workspace')

describe('copyAttachmentToWorkspace', () => {
  beforeEach(() => {
    ipcApiRequest.mockReset()
    ipcApiRequest.mockImplementation(async (route: string) => {
      if (route === 'file.get_metadata') return null
      return undefined
    })
  })

  it('copies an external attachment into the workspace root with its sanitized filename', async () => {
    const { reference } = await copyAttachmentToWorkspace(tmpReport, workspaceRoot, 'report.md')

    expect(reference).toBe('/workspace/report.md')
    expect(ipcApiRequest).toHaveBeenCalledWith('file.copy', {
      sourcePath: '/tmp/report.md',
      destPath: '/workspace/report.md'
    })
  })

  it('reserves destinations across sequential copies with the same basename', async () => {
    const reservation = { reservedDestinations: new Set<string>() }

    const first = await copyAttachmentToWorkspace(tmpAReport, workspaceRoot, 'report.md', reservation)
    const second = await copyAttachmentToWorkspace(tmpBReport, workspaceRoot, 'report.md', reservation)

    expect(first.reference).toBe('/workspace/report.md')
    expect(second.reference).toBe('/workspace/report (1).md')
    expect(ipcApiRequest).toHaveBeenNthCalledWith(2, 'file.copy', {
      sourcePath: '/tmp/a/report.md',
      destPath: '/workspace/report.md'
    })
    expect(ipcApiRequest).toHaveBeenNthCalledWith(4, 'file.copy', {
      sourcePath: '/tmp/b/report.md',
      destPath: '/workspace/report (1).md'
    })
  })

  it('picks the next available filename when the destination already exists', async () => {
    ipcApiRequest.mockImplementation(async (route: string, input?: { path?: string }) => {
      if (route === 'file.get_metadata') {
        return input?.path === '/workspace/report.md' ? { kind: 'file', mime: 'text/markdown' } : null
      }
      return undefined
    })

    const { reference } = await copyAttachmentToWorkspace(tmpReport, workspaceRoot, 'report.md')

    expect(reference).toBe('/workspace/report (1).md')
    expect(ipcApiRequest).toHaveBeenCalledWith('file.copy', {
      sourcePath: '/tmp/report.md',
      destPath: '/workspace/report (1).md'
    })
  })

  it('copies into a UNC workspace without requiring a canonical destination key', async () => {
    const { reference } = await copyAttachmentToWorkspace(tmpReport, uncWorkspace, 'report.md')

    expect(reference).toBe('\\\\server\\share\\workspace\\report.md')
    expect(ipcApiRequest).toHaveBeenCalledWith('file.copy', {
      sourcePath: '/tmp/report.md',
      destPath: '\\\\server\\share\\workspace\\report.md'
    })
  })
})
