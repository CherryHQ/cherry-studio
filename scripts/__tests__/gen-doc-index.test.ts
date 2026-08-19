import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'

import { generateIndex, generateSourcesIndex } from '../gen-doc-index'

const tempDirs: string[] = []
const makeRepo = (files: Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-index-'))
  tempDirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('generateIndex', () => {
  it('lists every doc under its domain with title from H1 and description from frontmatter', () => {
    const root = makeRepo({
      'docs/contrib/dev.md': '---\ndescription: Set up the environment\n---\n\n# Development Setup\n',
      'docs/i18n/README.md': '---\ndescription: Documentation translation rules\n---\n\n# Bilingual Documentation\n',
      'docs/references/ai/README.md': '---\ndescription: The AI pipeline\nsources:\n  - src\n---\n\n# AI Reference\n',
      'docs/references/ai/tools.md': '---\ndescription: Tool registry\nsources:\n  - src\n---\n\n# Tool Registry\n',
      src: ''
    })
    const index = generateIndex(root)
    expect(index).toContain('| [Development Setup](./contrib/dev.md) | Set up the environment |')
    expect(index).toContain('## Documentation Governance')
    expect(index).toContain('| [Bilingual Documentation](./i18n/README.md) | Documentation translation rules |')
    expect(index).toContain('### AI')
    expect(index).toContain('| [AI Reference](./references/ai/README.md) | The AI pipeline |')
    expect(index.indexOf('AI Reference')).toBeLessThan(index.indexOf('Tool Registry'))
  })

  it('generates a stable machine index of source prefixes', () => {
    const root = makeRepo({
      'docs/contrib/process.md': '---\ndescription: Process\n---\n\n# Process\n',
      'docs/references/data/README.md':
        '---\ndescription: Data\nsources:\n  - src/shared/data\n  - src/main/data\n---\n\n# Data\n',
      'src/main/data/file.ts': '',
      'src/shared/data/file.ts': ''
    })
    expect(JSON.parse(generateSourcesIndex(root))).toEqual({
      version: 1,
      documents: [
        {
          path: 'docs/references/data/README.md',
          sources: ['src/main/data', 'src/shared/data']
        }
      ]
    })
  })

  it('is deterministic for the same tree', () => {
    const files = {
      'docs/contrib/a.md': '---\ndescription: A\n---\n\n# A\n',
      'docs/references/data/README.md': '---\ndescription: Data\n---\n\n# Data\n'
    }
    expect(generateIndex(makeRepo(files))).toBe(generateIndex(makeRepo(files)))
  })
})
