import type { ExternalAppInfo } from '@shared/types/externalApp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildEditorUrl, openExternalApp } from '../editor'

const vscodeApp: ExternalAppInfo = {
  id: 'vscode',
  name: 'Visual Studio Code',
  protocol: 'vscode://',
  tags: ['code-editor'],
  path: '/Applications/Visual Studio Code.app'
}

const windowsTerminalApp: ExternalAppInfo = {
  id: 'wt',
  name: 'Windows Terminal',
  executable: 'wt.exe',
  tags: ['terminal'],
  path: 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe'
}

describe('buildEditorUrl', () => {
  it('builds a file-open deep link for protocol-based apps', () => {
    // Absolute Unix paths keep a leading "/" after the `file/` authority, so the
    // URL contains a double slash — matching the existing buildEditorUrl shape.
    expect(buildEditorUrl(vscodeApp, '/tmp/a b/report.txt')).toBe('vscode://file//tmp/a%20b/report.txt?windowId=_blank')
  })

  it('throws when the app has no protocol', () => {
    expect(() => buildEditorUrl(windowsTerminalApp, '/tmp')).toThrow('has no URL protocol')
  })
})

describe('openExternalApp', () => {
  const openMock = vi.hoisted(() => vi.fn())

  beforeEach(() => {
    openMock.mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { externalApps: { open: openMock } }
    })
    Object.defineProperty(window, 'open', { configurable: true, value: vi.fn() })
  })

  it('opens a deep-link URL for protocol-based apps', async () => {
    await openExternalApp(vscodeApp, '/tmp/workspace')

    expect(window.open).toHaveBeenCalledWith('vscode://file//tmp/workspace?windowId=_blank')
    expect(openMock).not.toHaveBeenCalled()
  })

  it('launches executable-based apps through the main process', async () => {
    openMock.mockResolvedValue(undefined)

    await openExternalApp(windowsTerminalApp, 'C:\\work\\project')

    expect(openMock).toHaveBeenCalledWith('wt', 'C:\\work\\project')
    expect(window.open).not.toHaveBeenCalled()
  })

  it('forwards the error when launching an executable-based app fails', async () => {
    openMock.mockRejectedValue(new Error('wt.exe was not found'))

    await expect(openExternalApp(windowsTerminalApp, 'C:\\work\\project')).rejects.toThrow('wt.exe was not found')
  })
})
