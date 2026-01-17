import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  return actual
})

vi.mock('../ReduxService', () => ({
  reduxService: {
    select: vi.fn(),
    subscribe: vi.fn()
  }
}))

import { formatGitTimestamp, NotesGitService } from '../NotesGitService'

class TestNotesGitService extends NotesGitService {
  public commitMessages: string[] = []
  public statusOutput = ''
  public statusCode = 0
  public addCode = 0
  public commitCode = 0
  public logOutput = ''
  public logCode = 0
  public diffOutput = ''
  public diffCode = 0
  public showOutput = ''
  public showCode = 0
  public calls: string[][] = []

  public async runCommitIfNeeded(notesPath: string) {
    return this.commitIfNeeded(notesPath)
  }

  protected override async runGitCommand(
    args: string[],
    _cwd: string
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    this.calls.push(args)

    if (args[0] === 'status') {
      return { code: this.statusCode, stdout: this.statusOutput, stderr: '' }
    }

    if (args[0] === 'add') {
      return { code: this.addCode, stdout: '', stderr: '' }
    }

    if (args[0] === 'commit') {
      if (args[1] === '-m' && typeof args[2] === 'string') {
        this.commitMessages.push(args[2])
      }
      return { code: this.commitCode, stdout: '', stderr: '' }
    }

    if (args[0] === 'log') {
      return { code: this.logCode, stdout: this.logOutput, stderr: '' }
    }

    if (args[0] === 'diff') {
      return { code: this.diffCode, stdout: this.diffOutput, stderr: '' }
    }

    if (args[0] === 'show') {
      return { code: this.showCode, stdout: this.showOutput, stderr: '' }
    }

    return { code: 0, stdout: '', stderr: '' }
  }
}

const getTempRoot = () => process.env.TMPDIR || process.env.TEMP || process.env.TMP || process.cwd()

describe('NotesGitService', () => {
  it('formats git timestamp in fixed pattern', () => {
    const date = new Date(2024, 0, 2, 3, 4, 5)
    expect(formatGitTimestamp(date)).toBe('2024-01-02 03:04:05')
  })

  it('normalizes commit interval to allowed options', () => {
    const service = new TestNotesGitService()
    const normalize = (service as unknown as { normalizeCommitInterval: (value: unknown) => number })
      .normalizeCommitInterval

    expect(normalize(undefined)).toBe(5)
    expect(normalize(1)).toBe(1)
    expect(normalize(10)).toBe(10)
    expect(normalize(2)).toBe(5)
    expect(normalize(120)).toBe(5)
  })

  it('skips commit when no changes exist', async () => {
    const service = new TestNotesGitService()
    service.statusOutput = ''

    const result = await service.runCommitIfNeeded('/tmp/notes')

    expect(result).toBe(false)
    expect(service.calls).toEqual([['status', '--porcelain']])
  })

  it('commits when changes exist', async () => {
    const service = new TestNotesGitService()
    service.statusOutput = ' M note.md\n'

    const result = await service.runCommitIfNeeded('/tmp/notes')

    expect(result).toBe(true)
    expect(service.commitMessages).toHaveLength(1)
    expect(service.commitMessages[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('returns history for notes file', async () => {
    const service = new TestNotesGitService()
    service.logOutput = 'hash1|2024-01-01 00:00:00|Init\nhash2|2024-01-02 00:00:00|Update'

    const result = await service.getFileHistory('/tmp/notes', '/tmp/notes/note.md')

    expect(result).toEqual([
      { hash: 'hash1', date: '2024-01-01 00:00:00', message: 'Init' },
      { hash: 'hash2', date: '2024-01-02 00:00:00', message: 'Update' }
    ])
    expect(service.calls[0]).toEqual(['log', '--pretty=format:%H|%ad|%s', '--date=iso', '--', 'note.md'])
  })

  it('returns empty history for path outside notes', async () => {
    const service = new TestNotesGitService()

    const result = await service.getFileHistory('/tmp/notes', '/tmp/other/note.md')

    expect(result).toEqual([])
    expect(service.calls).toEqual([])
  })

  it('returns diff for commit and file', async () => {
    const service = new TestNotesGitService()
    service.diffOutput = 'diff --git a/note.md b/note.md'

    const result = await service.getFileDiff('/tmp/notes', '/tmp/notes/note.md', 'hash1')

    expect(result).toEqual({ diff: 'diff --git a/note.md b/note.md', truncated: false })
    expect(service.calls[0]).toEqual(['diff', 'hash1', '--', 'note.md'])
  })

  it('returns empty diff when commit hash missing', async () => {
    const service = new TestNotesGitService()

    const result = await service.getFileDiff('/tmp/notes', '/tmp/notes/note.md', '')

    expect(result).toEqual({ diff: '', truncated: false })
    expect(service.calls).toEqual([])
  })

  it('restores file content from selected commit', async () => {
    const service = new TestNotesGitService()
    service.showOutput = '# restored'

    const tmpDir = fs.mkdtempSync(path.join(getTempRoot(), 'notes-git-'))
    const filePath = path.join(tmpDir, 'note.md')
    fs.writeFileSync(filePath, '# current', 'utf-8')

    try {
      await service.restoreFile(tmpDir, filePath, 'abcdef1')

      const restored = fs.readFileSync(filePath, 'utf-8')
      expect(restored).toBe('# restored')
      expect(service.calls[0]).toEqual(['show', 'abcdef1:note.md'])
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('rejects restore when commit hash invalid', async () => {
    const service = new TestNotesGitService()

    const tmpDir = fs.mkdtempSync(path.join(getTempRoot(), 'notes-git-'))
    const filePath = path.join(tmpDir, 'note.md')
    fs.writeFileSync(filePath, '# current', 'utf-8')

    try {
      await expect(service.restoreFile(tmpDir, filePath, 'hash1')).rejects.toThrow('Invalid commit hash')
      expect(service.calls).toEqual([])
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
