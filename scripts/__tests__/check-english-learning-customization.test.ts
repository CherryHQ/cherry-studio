import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  checkEnglishLearningCustomization,
  type CustomizationContract,
  ENGLISH_LEARNING_CONTRACTS,
  runCli
} from '../check-english-learning-customization'

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../..')

function captureStream(): { output: () => string; stream: Pick<typeof process.stdout, 'write'> } {
  let output = ''
  return {
    output: () => output,
    stream: {
      write: (chunk: string | Uint8Array): boolean => {
        output += chunk.toString()
        return true
      }
    }
  }
}

describe('check-english-learning-customization', () => {
  it('passes against the repository customization seams', () => {
    expect(checkEnglishLearningCustomization(REPOSITORY_ROOT)).toEqual([])
    expect(ENGLISH_LEARNING_CONTRACTS.length).toBeGreaterThan(10)
  })

  it('reports missing files and missing markers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'english-learning-contracts-'))
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src/present.ts'), 'one marker')
    const contracts: CustomizationContract[] = [
      { file: 'src/missing.ts', markers: ['anything'] },
      { file: 'src/present.ts', markers: ['one marker', 'second marker'] }
    ]

    expect(checkEnglishLearningCustomization(root, contracts)).toEqual([
      { file: 'src/missing.ts', missing: 'file' },
      { file: 'src/present.ts', missing: 'second marker' }
    ])
  })

  it('prints a concise success result for the repository', () => {
    const stdout = captureStream()
    const stderr = captureStream()

    expect(runCli(REPOSITORY_ROOT, stdout.stream, stderr.stream)).toBe(0)
    expect(stdout.output()).toContain('customization contracts passed')
    expect(stderr.output()).toBe('')
  })
})
