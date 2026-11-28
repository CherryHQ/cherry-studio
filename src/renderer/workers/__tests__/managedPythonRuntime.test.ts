import { describe, expect, it, vi } from 'vitest'

import { prepareManagedPythonRuntime } from '../managedPythonRuntime'

const versions = { openpyxl: '3.1.5', etXmlfile: '2.0.0', python: '3.13.2' }

describe('managed Agent Python runtime', () => {
  it('reports installed versions only after managed packages load and match the pinned image', async () => {
    let loaded = false
    const diagnostics = await prepareManagedPythonRuntime({
      version: '0.28.0',
      loadPackage: async () => {
        loaded = true
      },
      runPython: () => {
        expect(loaded).toBe(true)
        return JSON.stringify(versions)
      }
    })
    expect(diagnostics).toEqual({ ...versions, imageVersion: 'pyodide-0.28.0-openpyxl-3.1.5-v1', pyodide: '0.28.0' })
  })

  it('reports a repairable managed dependency error for missing or corrupt wheels', async () => {
    const runPython = vi.fn()
    await expect(
      prepareManagedPythonRuntime({
        version: '0.28.0',
        loadPackage: async () => {
          throw new Error('integrity mismatch')
        },
        runPython
      })
    ).rejects.toThrow('Repair the application installation')
    expect(runPython).not.toHaveBeenCalled()
  })

  it('does not accept a package or interpreter version outside the managed image', async () => {
    await expect(
      prepareManagedPythonRuntime({
        version: '0.28.0',
        loadPackage: async () => {},
        runPython: () => JSON.stringify({ ...versions, openpyxl: '0.0.0' })
      })
    ).rejects.toThrow('No package installation was attempted')
    const loadPackage = vi.fn()
    await expect(prepareManagedPythonRuntime({ version: '0.29.0', loadPackage, runPython: vi.fn() })).rejects.toThrow(
      'Managed Python dependency'
    )
    expect(loadPackage).not.toHaveBeenCalled()
  })
})
