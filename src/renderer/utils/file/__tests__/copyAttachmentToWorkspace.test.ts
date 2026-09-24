import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ipcApiRequest } = vi.hoisted(() => ({
  ipcApiRequest: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcApiRequest }
}))

import { copyAttachmentToWorkspace } from '../copyAttachmentToWorkspace'

describe('copyAttachmentToWorkspace', () => {
  beforeEach(() => {
    ipcApiRequest.mockReset()
    ipcApiRequest.mockImplementation(async (route: string) => {
      if (route === 'file.get_metadata') return null
      return undefined
    })
  })

  it('copies an external attachment into the workspace root with its sanitized filename', async () => {
    const copiedPath = await copyAttachmentToWorkspace('/tmp/report.md', '/workspace', 'report.md')

    expect(copiedPath).toBe('/workspace/report.md')
    expect(ipcApiRequest).toHaveBeenCalledWith('file.copy', {
      sourcePath: '/tmp/report.md',
      destPath: '/workspace/report.md'
    })
  })

  it('reserves destinations across sequential copies with the same basename', async () => {
    const reservation = { reservedDestinations: new Set<string>() }

    const firstPath = await copyAttachmentToWorkspace('/tmp/a/report.md', '/workspace', 'report.md', reservation)
    const secondPath = await copyAttachmentToWorkspace('/tmp/b/report.md', '/workspace', 'report.md', reservation)

    expect(firstPath).toBe('/workspace/report.md')
    expect(secondPath).toBe('/workspace/report (1).md')
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
    ipcApiRequest.mockImplementation(async (route: string, input?: { destPath?: string }) => {
      if (route === 'file.get_metadata') {
        return input?.destPath === '/workspace/report.md' ? { kind: 'file', mime: 'text/markdown' } : null
      }
      return undefined
    })

    const copiedPath = await copyAttachmentToWorkspace('/tmp/report.md', '/workspace', 'report.md')

    expect(copiedPath).toBe('/workspace/report (1).md')
    expect(ipcApiRequest).toHaveBeenCalledWith('file.copy', {
      sourcePath: '/tmp/report.md',
      destPath: '/workspace/report (1).md'
    })
  })
})
