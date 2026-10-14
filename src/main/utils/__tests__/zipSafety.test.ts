import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { assertZipEntriesWithin } from '../zipSafety'

// C4 (mcp-services-1): node-stream-zip writes each entry at path.join(baseDir, name)
// with no containment check, so an archive crafted with a `../` entry could
// overwrite files outside the extraction dir. The guard must reject before extraction.
describe('assertZipEntriesWithin', () => {
  const baseDir = path.join('/', 'tmp', 'extract')

  // Skip on Windows — path separator / resolution semantics differ.
  const testFn = process.platform === 'win32' ? it.skip : it

  testFn('accepts entries nested inside the base dir', () => {
    expect(() => assertZipEntriesWithin(['manifest.json', 'server/index.js', 'assets/icon.png'], baseDir)).not.toThrow()
  })

  testFn('accepts the base dir itself (directory entries)', () => {
    expect(() => assertZipEntriesWithin(['.'], baseDir)).not.toThrow()
  })

  testFn('rejects a parent-traversal entry', () => {
    expect(() => assertZipEntriesWithin(['../escape.txt'], baseDir)).toThrow('zip-slip')
  })

  testFn('rejects a deep traversal entry mixed with safe entries', () => {
    expect(() => assertZipEntriesWithin(['manifest.json', '../../../etc/cron.d/evil'], baseDir)).toThrow('zip-slip')
  })

  testFn('rejects an absolute-path entry', () => {
    expect(() => assertZipEntriesWithin(['/etc/passwd'], baseDir)).toThrow('zip-slip')
  })

  testFn('rejects a sibling-prefix entry that is not actually nested', () => {
    // `/tmp/extract_evil` shares the base string prefix but is not within the base dir.
    expect(() => assertZipEntriesWithin(['../extract_evil/x'], baseDir)).toThrow('zip-slip')
  })
})
