import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { verifyBundle, writeBundle } from '../release/js-bundle'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function bundle() {
  const root = mkdtempSync(path.join(tmpdir(), 'release-bundle-'))
  roots.push(root)
  const directory = path.join(root, 'out')
  for (const name of ['main', 'preload', 'renderer', 'utility-process']) {
    mkdirSync(path.join(directory, name), { recursive: true })
    writeFileSync(path.join(directory, name, 'entry.js'), `module.exports = '${name}'`)
  }
  const options = {
    directory,
    manifestPath: path.join(root, 'manifest.json'),
    sourceSha: 'a'.repeat(40),
    edition: 'cn',
    version: '2.2.1'
  }
  writeBundle(options)
  return options
}

describe('release JS bundle integrity', () => {
  it('verifies a complete bundle after copying it to a packaging workspace', () => {
    const options = bundle()
    const copied = path.join(path.dirname(options.directory), 'packaging-out')
    cpSync(options.directory, copied, { recursive: true })
    expect(() => verifyBundle({ ...options, directory: copied })).not.toThrow()
  })

  it.each(['sourceSha', 'edition', 'version'])('rejects a different %s', (field) => {
    const options = bundle()
    expect(() => verifyBundle({ ...options, [field]: 'different' })).toThrow('mismatch')
  })

  it('rejects changed bytes even when the file size is unchanged', () => {
    const options = bundle()
    writeFileSync(path.join(options.directory, 'main/entry.js'), "module.exports = 'fake'")
    expect(() => verifyBundle(options)).toThrow('checksum mismatch')
  })

  it('rejects leftover output and missing utility-process entries', () => {
    const options = bundle()
    writeFileSync(path.join(options.directory, 'main/stale.js'), 'stale')
    expect(() => verifyBundle(options)).toThrow('file mismatch')
    rmSync(path.join(options.directory, 'utility-process'), { recursive: true })
    expect(() => verifyBundle(options)).toThrow('Missing bundle output: utility-process')
  })

  it('rejects symlinks instead of hashing files outside the bundle', () => {
    const options = bundle()
    symlinkSync(options.manifestPath, path.join(options.directory, 'main/link.js'))
    expect(() => verifyBundle(options)).toThrow('Unsupported bundle entry')
  })
})
