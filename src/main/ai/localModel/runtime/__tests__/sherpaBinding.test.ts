import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

const nodeRequire = createRequire(import.meta.url)
const addonPath = nodeRequire.resolve('sherpa-onnx-node/addon.js')
const addonSource = readFileSync(addonPath, 'utf8')

function loadAddon(bindingPath: string | undefined, resolveBinding: (id: string) => unknown): unknown {
  const module = { exports: {} }
  runInNewContext(
    addonSource,
    {
      module,
      __dirname: path.dirname(addonPath),
      process: { env: { CHERRY_SHERPA_ONNX_BINDING_PATH: bindingPath } },
      require: (id: string) => {
        if (id === 'os') return os
        if (id === 'path') return path
        return resolveBinding(id)
      }
    },
    { filename: addonPath }
  )
  return module.exports
}

describe('Sherpa native binding loading', () => {
  it('loads an explicitly downloaded binding without touching bundled native loaders', () => {
    const bindingPath = '/installed/sherpa-onnx.node'
    const downloadedBinding = { source: 'explicit-download' }

    const loaded = loadAddon(bindingPath, (id) => {
      if (id === bindingPath) return downloadedBinding
      throw new Error(`Unexpected bundled native load: ${id}`)
    })

    expect(loaded).toBe(downloadedBinding)
  })

  it('keeps the upstream static binding when no explicit path is provided', () => {
    const bundledBinding = { source: 'bundled-static' }

    const loaded = loadAddon(undefined, (id) => {
      if (id === './addon-static-import') return bundledBinding
      throw new Error(`Unexpected native load: ${id}`)
    })

    expect(loaded).toBe(bundledBinding)
  })

  it('keeps upstream candidate lookup when the static binding is unavailable', () => {
    const fallbackBinding = { source: 'bundled-fallback' }

    const loaded = loadAddon(undefined, (id) => {
      if (id === './addon-static-import') return null
      if (id === '../build/Release/sherpa-onnx.node') return fallbackBinding
      throw new Error(`Unexpected native load: ${id}`)
    })

    expect(loaded).toBe(fallbackBinding)
  })
})
