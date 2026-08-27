import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectRoot = path.join(import.meta.dirname, '..', '..')

describe('Windows portable packaging', () => {
  it('isolates extracted resources for each launcher invocation', () => {
    const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
      portable?: { unpackDirName?: boolean | string }
    }

    expect(config.portable?.unpackDirName).toBe(true)
  })
})
