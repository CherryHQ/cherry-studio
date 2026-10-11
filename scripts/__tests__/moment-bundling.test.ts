import path from 'node:path'
import { runInNewContext } from 'node:vm'

import { build } from 'vite'
import { expect, it } from 'vitest'

import config from '../../electron.vite.config'

it('keeps Moment callable for bundled CommonJS logging dependencies', async () => {
  const entry = path.join(import.meta.dirname, 'fixtures/momentLogging.cjs')
  const output = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      ...config.main?.resolve,
      mainFields: ['module', 'jsnext:main', 'jsnext']
    },
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['cjs'] }
    }
  })
  const bundle = Array.isArray(output) ? output[0] : output
  if (!('output' in bundle)) throw new Error('Expected an in-memory bundle')
  const chunk = bundle.output.find((item) => item.type === 'chunk' && item.isEntry)
  if (!chunk || chunk.type !== 'chunk') throw new Error('Expected a CommonJS entry chunk')
  const module = { exports: undefined }
  runInNewContext(chunk.code, { module, exports: module.exports })
  expect(module.exports).toBe('2026-10-12')
})
