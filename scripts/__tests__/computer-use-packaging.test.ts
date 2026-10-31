import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, it } from 'vitest'

const projectRoot = path.join(import.meta.dirname, '..', '..')

it('ships an SDK that loads and resolves types without a local checkout or native runtime', async () => {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const require = createRequire(import.meta.url)
  const sdkRoot = path.dirname(path.dirname(require.resolve('@cherrystudio/computer-use')))
  const sdkManifest = JSON.parse(await readFile(path.join(sdkRoot, 'package.json'), 'utf8'))
  expect(sdkManifest.version).toBe(manifest.dependencies['@cherrystudio/computer-use'])

  const consumer = await mkdtemp(path.join(tmpdir(), 'cherry-computer-use-package-'))
  try {
    const installed = path.join(consumer, 'node_modules/@cherrystudio/computer-use')
    await cp(sdkRoot, installed, { recursive: true, dereference: true })

    for (const extension of ['mjs', 'cjs']) {
      const header =
        extension === 'mjs'
          ? "import { ComputerUse, ComputerUseError } from '@cherrystudio/computer-use'"
          : "const { ComputerUse, ComputerUseError } = require('@cherrystudio/computer-use')"
      const entry = path.join(consumer, `consumer.${extension}`)
      await writeFile(
        entry,
        `${header}
const assert = ${extension === 'mjs' ? "(await import('node:assert/strict')).default" : "require('node:assert/strict')"}
assert.rejects(ComputerUse.start({ runtimePath: './missing-runtime' }), error => {
  assert(error instanceof ComputerUseError)
  assert.equal(error.code, 'RUNTIME_NOT_FOUND')
  return true
}).catch(error => { throw error })
`
      )
      execFileSync(process.execPath, [entry], {
        cwd: consumer,
        timeout: 10_000,
        env: { ...process.env, NODE_PATH: '' }
      })
    }

    for (const extension of ['mts', 'cts']) {
      await writeFile(
        path.join(consumer, `consumer.${extension}`),
        `import { ComputerUse, type ComputerUseClient } from '@cherrystudio/computer-use'
const client: Promise<ComputerUseClient> = ComputerUse.start({}, { signal: new AbortController().signal })
void client
`
      )
    }
    execFileSync(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--module',
        'NodeNext',
        '--target',
        'ES2024',
        'consumer.mts',
        'consumer.cts'
      ],
      { cwd: consumer, timeout: 15_000 }
    )
  } finally {
    await rm(consumer, { recursive: true, force: true })
  }
})
