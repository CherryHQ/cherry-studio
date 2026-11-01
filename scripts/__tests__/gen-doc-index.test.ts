/** Covers table-cell escaping in the generated documentation index. */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { describe, expect, it } from 'vitest'

import { generateIndex } from '../docsGovernance/gen-doc-index'

const scaffold = (root: string): void => {
  for (const dir of ['contrib', 'i18n', 'references']) {
    fs.mkdirSync(path.join(root, 'docs', dir), { recursive: true })
  }
}

const writeContribDoc = (root: string, name: string, content: string): void => {
  fs.writeFileSync(path.join(root, 'docs', 'contrib', name), content)
}

const withTempRoot = (run: (root: string) => void): void => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-index-'))
  try {
    run(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

describe('generateIndex escapes table cells', () => {
  it('keeps a pipe in a description from splitting the table row', () => {
    withTempRoot((root) => {
      scaffold(root)
      writeContribDoc(root, 'import.md', '---\ndescription: Import from URL | clipboard\n---\n\n# Import\n')
      const output = generateIndex(root)
      expect(output).toContain('| [Import](./contrib/import.md) | Import from URL \\| clipboard |')
    })
  })

  it('keeps a pipe in an H1 title from splitting the table row', () => {
    withTempRoot((root) => {
      scaffold(root)
      writeContribDoc(root, 'faq.md', '---\ndescription: Frequently asked questions\n---\n\n# FAQ | Troubleshooting\n')
      const output = generateIndex(root)
      expect(output).toContain('| [FAQ \\| Troubleshooting](./contrib/faq.md) | Frequently asked questions |')
    })
  })

  it('leaves ordinary titles and descriptions untouched', () => {
    withTempRoot((root) => {
      scaffold(root)
      writeContribDoc(root, 'plain.md', '---\ndescription: How to contribute code\n---\n\n# Contributing\n')
      const output = generateIndex(root)
      expect(output).toContain('| [Contributing](./contrib/plain.md) | How to contribute code |')
    })
  })
})
