import fs from 'node:fs'
import os from 'node:os'

import { application } from '@application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/constant', () => ({
  isWin: true
}))

import { prepareContext } from '../utils'

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
    vi.mocked(fs.mkdtempSync).mockReturnValueOnce('/tmp/cherry-ovocr-1').mockReturnValueOnce('/tmp/cherry-ovocr-2')
    vi.mocked(os.cpus).mockReturnValue([{ model: 'Intel Ultra 7' }] as never)
  })

  it('allocates an isolated working directory for each request', () => {
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
    const second = prepareContext(
      {
        id: 'file-2',
        path: '/tmp/b.png',
        type: 'image'
      } as never,
      config as never
    )

    expect(first.workingDirectory).toBe('/tmp/cherry-ovocr-1')
    expect(first.imgDirectory).toBe('/tmp/cherry-ovocr-1/img')
    expect(first.outputDirectory).toBe('/tmp/cherry-ovocr-1/output')
    expect(second.workingDirectory).toBe('/tmp/cherry-ovocr-2')
    expect(second.imgDirectory).toBe('/tmp/cherry-ovocr-2/img')
    expect(second.outputDirectory).toBe('/tmp/cherry-ovocr-2/output')
    expect(first.workingDirectory).not.toBe(second.workingDirectory)
  })
})
