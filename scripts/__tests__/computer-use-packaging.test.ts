import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { x } from 'tar'
import { expect, it } from 'vitest'

const projectRoot = path.join(import.meta.dirname, '..', '..')

it('ships an SDK that loads and resolves types without a local checkout or native runtime', async () => {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const dependency: string = manifest.dependencies['@cherrystudio/computer-use']
  expect(dependency).toMatch(/^file:.*\.tgz$/)

  const consumer = await mkdtemp(path.join(tmpdir(), 'cherry-computer-use-package-'))
  try {
    const installed = path.join(consumer, 'node_modules/@cherrystudio/computer-use')
    await mkdir(installed, { recursive: true })
    await x({ file: path.resolve(projectRoot, dependency.slice('file:'.length)), cwd: installed, strip: 1 })

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
assert.rejects(ComputerUse.start(), error => {
  assert(error instanceof ComputerUseError)
  assert.equal(error.code, 'RUNTIME_NOT_FOUND')
  return true
}).catch(error => { throw error })
`
      )
      execFileSync(process.execPath, [entry], { cwd: consumer, timeout: 10_000 })
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
    const require = createRequire(import.meta.url)
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
