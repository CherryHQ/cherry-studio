import { describe, expect, it } from 'vitest'

import { buildDirectoryItems } from './buildDirectoryItems'

const createMockFile = (name: string, size: number, webkitRelativePath?: string) => {
  const file = new File([new Uint8Array(size)], name, { type: 'application/octet-stream' })

  if (webkitRelativePath) {
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      value: webkitRelativePath
    })
  }

  return file
}

describe('buildDirectoryItems', () => {
  it('ignores files without a relative directory path', () => {
    expect(buildDirectoryItems([createMockFile('guide.pdf', 1024)])).toEqual([])
  })

  it('groups files by directory and sums file count and size', () => {
    expect(
      buildDirectoryItems([
        createMockFile('guide.pdf', 1024, 'docs/guide.pdf'),
        createMockFile('api.md', 2048, 'docs/api.md'),
        createMockFile('report.csv', 512, 'reports/report.csv')
      ])
    ).toEqual([
      { name: 'docs', fileCount: 2, totalSize: 3072 },
      { name: 'reports', fileCount: 1, totalSize: 512 }
    ])
  })
})
