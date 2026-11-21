import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import manifest from '../../src/shared/data/presets/agentPythonRuntime.json'

const root = resolve('src/renderer/public/pyodide')
describe('bundled Agent Python image integrity', () => {
  it('ships exactly the pinned core and managed package bytes on every app upgrade', () => {
    for (const [file, expected] of Object.entries(manifest.files)) {
      const bytes = readFileSync(resolve(root, file))
      expect(bytes.length, file).toBe(expected.bytes)
      expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(expected.sha256)
    }
  })

  it('resolves managed wheels locally while retaining optional packages on the existing CDN', () => {
    const lock = JSON.parse(readFileSync(resolve(root, 'pyodide-lock.json'), 'utf8'))
    expect(lock.info.python).toBe(manifest.pythonVersion)
    expect(lock.packages.openpyxl).toMatchObject({
      version: manifest.packages.openpyxl,
      file_name: 'openpyxl-3.1.5-py2.py3-none-any.whl',
      depends: ['et-xmlfile']
    })
    expect(lock.packages['et-xmlfile']).toMatchObject({
      version: manifest.packages['et-xmlfile'],
      file_name: 'et_xmlfile-2.0.0-py3-none-any.whl'
    })
    expect(lock.packages.numpy.file_name).toMatch(/^https:\/\/cdn.jsdelivr.net\/pyodide\/v0.28.0\/full\//)
    for (const name of ['openpyxl', 'et-xmlfile']) {
      const file = lock.packages[name].file_name as keyof typeof manifest.files
      expect(lock.packages[name].sha256).toBe(manifest.files[file].sha256)
    }
  })
})
