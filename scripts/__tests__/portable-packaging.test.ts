import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectRoot = path.join(import.meta.dirname, '..', '..')

describe('Windows portable packaging', () => {
  it('pins the audited electron-builder portable unpack contract', () => {
    const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
      portable?: { unpackDirName?: boolean | string }
    }
    const packageManifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>
    }

    expect({
      electronBuilder: packageManifest.devDependencies?.['electron-builder'],
      unpackDirName: config.portable?.unpackDirName
    }).toEqual({
      electronBuilder: '26.15.6',
      unpackDirName: true
    })
  })
})
