import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkNoteFormat } from '../verify-agent-note-format'

const tempDirs: string[] = []
const makeNotes = (layout: Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-note-format-'))
  tempDirs.push(root)
  for (const [relative, content] of Object.entries(layout)) {
    const full = path.join(root, relative)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

const noteOf = (sections: readonly string[], status = 'proposed'): string =>
  [
    '# Agent Note: A topic',
    '',
    `Status: ${status}`,
    '',
    ...sections.flatMap((section) => [`## ${section}`, '', 'Body.', '']),
    ''
  ].join('\n')

const failuresFor = (layout: Record<string, string>): string[] => checkNoteFormat(makeNotes(layout))

const PROPOSED_SECTIONS = ['Problem', 'Proposal', 'Alternatives considered', 'Acceptance criteria', 'Risks']
const IMPLEMENTED_SECTIONS = ['Problem', 'Decision', 'Alternatives considered', 'Consequences']

describe('checkNoteFormat', () => {
  it('accepts a well-formed proposed note and ignores the directory READMEs', () => {
    const dir = makeNotes({
      'README.md': '# Agent Notes',
      'README.zh.md': '# 代理笔记',
      'proposed/process/2026-01-31-a-topic.md': noteOf(PROPOSED_SECTIONS)
    })
    expect(checkNoteFormat(dir)).toEqual([])
  })

  it('accepts a well-formed implemented note and its Chinese counterpart', () => {
    const dir = makeNotes({
      'implemented/bug-fix/2026-01-31-a-fix.md': noteOf(IMPLEMENTED_SECTIONS, 'implemented'),
      'implemented/bug-fix/2026-01-31-a-fix.zh.md': noteOf(IMPLEMENTED_SECTIONS, 'implemented')
    })
    expect(checkNoteFormat(dir)).toEqual([])
  })

  it('accepts a well-formed rejected note, which owes no lifecycle sections beyond the common ones', () => {
    const dir = makeNotes({
      'rejected/process/2026-01-31-a-topic.md': noteOf(['Problem', 'Alternatives considered'], 'rejected')
    })
    expect(checkNoteFormat(dir)).toEqual([])
  })

  it('rejects a note that drops the mandatory Alternatives considered section', () => {
    const failures = failuresFor({
      'implemented/process/2026-01-31-a-topic.md': noteOf(['Problem', 'Decision', 'Consequences'], 'implemented')
    })
    expect(failures).toEqual([expect.stringContaining("'## Alternatives considered'")])
  })

  it('rejects a note whose first section is not Problem', () => {
    const failures = failuresFor({
      'implemented/process/2026-01-31-a-topic.md': noteOf(
        ['Decision', 'Problem', 'Alternatives considered', 'Consequences'],
        'implemented'
      )
    })
    expect(failures).toEqual([expect.stringContaining("the first section must be '## Problem'")])
  })

  it('rejects a note whose Alternatives considered follows the closing section', () => {
    const failures = failuresFor({
      'implemented/process/2026-01-31-a-topic.md': noteOf(
        ['Problem', 'Decision', 'Consequences', 'Alternatives considered'],
        'implemented'
      )
    })
    expect(failures).toEqual([expect.stringContaining("'## Alternatives considered' comes before '## Consequences'")])
  })

  it('rejects a status line that contradicts the lifecycle directory', () => {
    const failures = failuresFor({
      'proposed/process/2026-01-31-a-topic.md': noteOf(PROPOSED_SECTIONS, 'implemented')
    })
    expect(failures).toEqual([expect.stringContaining("'Status: implemented' contradicts the 'proposed/' directory")])
  })

  it('rejects a note stored outside a lifecycle directory', () => {
    const failures = failuresFor({ '2026-01-31-a-topic.md': noteOf(['Problem']) })
    expect(failures).toEqual([expect.stringContaining('a note lives at {lifecycle}/{class}/yyyy-mm-dd-topic.md')])
  })

  it('rejects a class directory outside the closed set', () => {
    const failures = failuresFor({ 'proposed/refactor/2026-01-31-a-topic.md': noteOf(PROPOSED_SECTIONS) })
    expect(failures).toEqual([expect.stringContaining("'refactor/' is not a class")])
  })

  it('rejects a filename without a leading date', () => {
    const failures = failuresFor({ 'proposed/process/a-topic.md': noteOf(PROPOSED_SECTIONS) })
    expect(failures).toEqual([expect.stringContaining('the filename does not start with a yyyy-mm-dd date')])
  })

  it('rejects a note whose Status line is quoted inside a fenced code block', () => {
    const failures = failuresFor({
      'proposed/process/2026-01-31-a-topic.md': [
        '# Agent Note: A topic',
        '',
        '~~~md',
        'Status: proposed',
        '~~~',
        '',
        ...PROPOSED_SECTIONS.flatMap((section) => [`## ${section}`, '', 'Body.', '']),
        ''
      ].join('\n')
    })
    expect(failures).toEqual([expect.stringContaining("missing the 'Status: <lifecycle>' line")])
  })

  it('rejects a note that only shows Alternatives considered inside a fenced code block', () => {
    const failures = failuresFor({
      'proposed/process/2026-01-31-a-topic.md': [
        '# Agent Note: A topic',
        '',
        'Status: proposed',
        '',
        '## Problem',
        '',
        'Body.',
        '',
        '## Proposal',
        '',
        'The template, quoted for reference:',
        '',
        '```md',
        '## Alternatives considered',
        '```',
        '',
        '## Acceptance criteria',
        '',
        'Body.',
        '',
        '## Risks',
        '',
        'Body.',
        ''
      ].join('\n')
    })
    expect(failures).toEqual([expect.stringContaining("missing the mandatory '## Alternatives considered' section")])
  })

  it('rejects frontmatter and a missing Agent Note title', () => {
    const failures = failuresFor({
      'proposed/process/2026-01-31-a-topic.md': `---\ndescription: x\n---\n${noteOf(PROPOSED_SECTIONS)}`
    })
    expect(failures).toEqual([
      expect.stringContaining('carries no frontmatter'),
      expect.stringContaining("'# Agent Note: <title>'")
    ])
  })
})
