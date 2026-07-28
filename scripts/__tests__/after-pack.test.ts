import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { packageSqliteVecExtension } from '../after-pack'

let tmpDirs: string[] = []

function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
  tmpDirs = []
})

describe('packageSqliteVecExtension', () => {
  it.each(['x64', 'arm64'] as const)('copies the Windows %s extension to app.asar.unpacked', (arch) => {
    const projectDir = makeTmpDir('after-pack-project-')
    const appOutDir = makeTmpDir('after-pack-output-')
    const packageName = `sqlite-vec-windows-${arch}`
    const source = path.join(projectDir, 'node_modules', '@aiany', packageName, 'vec0.dll')
    fs.mkdirSync(path.dirname(source), { recursive: true })
    fs.writeFileSync(source, `vec0-${arch}`)

    const target = packageSqliteVecExtension({ projectDir, appOutDir, arch })

    expect(target).toBe(
      path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', '@aiany', packageName, 'vec0.dll')
    )
    expect(fs.readFileSync(target, 'utf8')).toBe(`vec0-${arch}`)
  })

  it('fails the build when the target architecture package is missing', () => {
    const projectDir = makeTmpDir('after-pack-project-')
    const appOutDir = makeTmpDir('after-pack-output-')

    expect(() => packageSqliteVecExtension({ projectDir, appOutDir, arch: 'x64' })).toThrow(
      /Missing sqlite-vec build dependency/
    )
  })
})
