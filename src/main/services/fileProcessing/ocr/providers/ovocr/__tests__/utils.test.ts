import type * as NodeChildProcess from 'node:child_process'
import type * as NodeFs from 'node:fs'
import fs from 'node:fs'
import type * as NodeOs from 'node:os'
import os from 'node:os'

import { application } from '@application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSyncMock, cpusMock, execMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  cpusMock: vi.fn(),
  execMock: vi.fn()
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  const mocked = {
    ...actual,
    existsSync: existsSyncMock
  }

  return {
    ...mocked,
    default: mocked
  }
})

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof NodeChildProcess>('node:child_process')
  const mocked = {
    ...actual,
    exec: execMock
  }

  return {
    ...mocked,
    default: mocked
  }
})

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('node:os')
  const mocked = {
    ...actual,
    cpus: cpusMock
  }

  return {
    ...mocked,
    default: mocked
  }
})

vi.mock('@main/constant', () => ({
  isWin: true
}))

import { executeExtraction, prepareContext } from '../utils'

describe('OvOcr prepareContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(application.getPath).mockImplementation((key: string) => {
      if (key === 'app.temp') {
        return '/tmp/app-temp'
      }

      if (key === 'feature.ovms.ovocr') {
        return '/mock/ovocr'
      }

      return `/mock/${key}`
    })
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(os.cpus).mockReturnValue([{ model: 'Intel Ultra 7' }] as never)
  })

  it('returns a working directory prefix without creating directories', () => {
    const config = {
      id: 'ovocr',
      type: 'builtin',
      capabilities: [
        {
          feature: 'text_extraction',
          inputs: ['image'],
          output: 'text'
        }
      ]
    }

    const first = prepareContext(
      {
        id: 'file-1',
        path: '/tmp/a.png',
        type: 'image'
      } as never,
      config as never
    )

    expect(first.workingDirectoryPrefix).toBe('/tmp/app-temp/cherry-ovocr-')
  })
})

describe('OvOcr executeExtraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(application.getPath).mockImplementation((key: string) => {
      if (key === 'feature.ovms.ovocr') {
        return '/mock/ovocr'
      }

      return `/mock/${key}`
    })
    vi.mocked(fs.existsSync).mockReturnValue(true)
  })

  it('passes AbortSignal to child process execution', async () => {
    const controller = new AbortController()
    const mkdtempSpy = vi.spyOn(fs.promises, 'mkdtemp').mockResolvedValue('/tmp/cherry-ovocr-1' as never)
    const copyFileSpy = vi.spyOn(fs.promises, 'copyFile').mockResolvedValue(undefined)
    const rmSpy = vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined)
    const mkdirSpy = vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined as never)
    const readFileSpy = vi.spyOn(fs.promises, 'readFile').mockResolvedValue('recognized text' as never)
    execMock.mockImplementation((_command, _options, callback) => {
      callback?.(null, '', '')
      return {} as never
    })

    try {
      await expect(
        executeExtraction({
          file: {
            path: '/tmp/test.png',
            type: 'image'
          } as never,
          signal: controller.signal,
          workingDirectoryPrefix: '/tmp/app-temp/cherry-ovocr-'
        })
      ).resolves.toEqual({
        text: 'recognized text'
      })

      expect(mkdtempSpy).toHaveBeenCalledWith('/tmp/app-temp/cherry-ovocr-')
      expect(execMock).toHaveBeenCalledWith(
        '"/mock/ovocr"',
        expect.objectContaining({
          cwd: '/tmp/cherry-ovocr-1',
          timeout: 60000,
          signal: controller.signal
        }),
        expect.any(Function)
      )
    } finally {
      mkdtempSpy.mockRestore()
      copyFileSpy.mockRestore()
      rmSpy.mockRestore()
      mkdirSpy.mockRestore()
      readFileSpy.mockRestore()
    }
  })
})
