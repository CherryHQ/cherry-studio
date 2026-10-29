import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { checkFile } from '../docsGovernance/check-doc-links'

describe('check-doc-links reference-style links', () => {
  let dir: string

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-doc-links-'))
    fs.writeFileSync(path.join(dir, 'exists.md'), '# exists\n')
    // Inline valid, inline broken, and a reference link that is broken (and one that is valid).
    fs.writeFileSync(
      path.join(dir, 'doc.md'),
      [
        '# Title',
        '',
        'Inline valid: [x](./exists.md)',
        'Inline broken: [y](./missing.md)',
        '',
        'Reference broken: [arch][arch]',
        'Reference valid: [ok][ok]',
        '',
        '[arch]: ./missing-ref.md',
        '[ok]: ./exists.md',
        ''
      ].join('\n')
    )
  })

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('flags broken inline and broken reference links, and ignores valid reference links', () => {
    const broken = checkFile(path.join(dir, 'doc.md'))
    const links = broken.map((b) => b.link)

    // Inline broken link is still caught.
    expect(links).toContain('./missing.md')
    // The reference definition points at a missing file, so it is caught too.
    expect(links).toContain('./missing-ref.md')
    // The valid reference link must NOT be reported (no false positives).
    expect(links).not.toContain('./exists.md')
  })

  it('does not treat a code-like `[a][b]` snippet without a definition as a broken link', () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'check-doc-links-code-'))
    // A regex character class written in prose must not be flagged (no `[0-9]:` definition exists).
    fs.writeFileSync(path.join(dir2, 'd.md'), 'Matches digits like [1-9][0-9].\n')
    const broken = checkFile(path.join(dir2, 'd.md'))
    expect(broken.every((b) => b.link !== '[1-9][0-9]')).toBe(true)
    fs.rmSync(dir2, { recursive: true, force: true })
  })
})
