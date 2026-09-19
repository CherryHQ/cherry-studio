import fs from 'fs/promises'
import path from 'path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { callBuiltinTool, toolText } from '../../__tests__/builtinMcpClient'
import { resolveFilesystemBaseDir } from '../config'
import { createFileSystemServer } from '../server'
import * as types from '../types'
import { validatePath } from '../types'

async function callFsTool(name: string, args: Record<string, unknown>, root: string) {
  const result = await callBuiltinTool(() => createFileSystemServer(root), name, args)
  if (result.isError) throw new Error(toolText(result))
  return result
}

const globTool = (args: Record<string, unknown>, root: string) => callFsTool('glob', args, root)
const lsTool = (args: Record<string, unknown>, root: string) => callFsTool('ls', args, root)
const readTool = (args: Record<string, unknown>, root: string) => callFsTool('read', args, root)
const editTool = (args: Record<string, unknown>, root: string) => callFsTool('edit', args, root)
const writeTool = (args: Record<string, unknown>, root: string) => callFsTool('write', args, root)
const deleteTool = (args: Record<string, unknown>, root: string) => callFsTool('delete', args, root)

describe('filesystem MCP security', () => {
  const tempDirs: string[] = []

  async function createTempDir(prefix: string) {
    const tempRoot = path.join(process.cwd(), '.context', 'vitest-temp')
    await fs.mkdir(tempRoot, { recursive: true })
    const tempDir = await fs.mkdtemp(path.join(tempRoot, prefix))
    tempDirs.push(tempDir)
    return tempDir
  }

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })))
  })

  it('prefers WORKSPACE_ROOT and falls back to args for filesystem root', () => {
    expect(resolveFilesystemBaseDir(['C:/args-root'], {})).toBe('C:/args-root')
    expect(resolveFilesystemBaseDir(['C:/args-root'], { WORKSPACE_ROOT: 'C:/env-root' })).toBe('C:/env-root')
    expect(resolveFilesystemBaseDir([], {})).toBeUndefined()
  })

  it('allows paths inside the configured root and rejects paths outside it', async () => {
    const workspaceRoot = await createTempDir('filesystem-root-')
    const outsideRoot = await createTempDir('filesystem-outside-')
    const insideFile = path.join(workspaceRoot, 'inside.txt')
    const outsideFile = path.join(outsideRoot, 'outside.txt')

    await fs.writeFile(insideFile, 'inside')
    await fs.writeFile(outsideFile, 'outside')

    await expect(validatePath(insideFile, workspaceRoot)).resolves.toBe(insideFile)
    await expect(validatePath(outsideFile, workspaceRoot)).rejects.toThrow('outside the configured workspace root')
  })

  it('rejects symlink escapes outside the configured root', async () => {
    const workspaceRoot = await createTempDir('filesystem-symlink-root-')
    const outsideRoot = await createTempDir('filesystem-symlink-outside-')
    const outsideFile = path.join(outsideRoot, 'secret.txt')
    const symlinkPath = path.join(workspaceRoot, 'escape-link')

    await fs.writeFile(outsideFile, 'top-secret')
    await fs.symlink(outsideFile, symlinkPath)

    await expect(validatePath(symlinkPath, workspaceRoot)).rejects.toThrow('outside the configured workspace root')
  })

  it('rejects relative path traversal outside the configured root', async () => {
    const workspaceRoot = await createTempDir('filesystem-relative-root-')
    const outsideFile = path.join(path.dirname(workspaceRoot), 'outside.txt')

    await fs.writeFile(outsideFile, 'outside')

    await expect(validatePath('../outside.txt', workspaceRoot)).rejects.toThrow('outside the configured workspace root')
  })

  it('rejects home expansion outside the configured root', async () => {
    const workspaceRoot = await createTempDir('filesystem-home-root-')

    await expect(validatePath('~/sensitive-file', workspaceRoot)).rejects.toThrow(
      'outside the configured workspace root'
    )
  })

  it('falls back to process.cwd() when baseDir is omitted', async () => {
    const workspaceRoot = await createTempDir('filesystem-cwd-root-')
    const allowedFile = path.join(workspaceRoot, 'allowed.txt')
    const outsideFile = path.join(path.dirname(workspaceRoot), 'outside.txt')

    await fs.writeFile(allowedFile, 'allowed')
    await fs.writeFile(outsideFile, 'outside')

    vi.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)

    await expect(validatePath('allowed.txt')).resolves.toBe(allowedFile)
    await expect(validatePath('../outside.txt')).rejects.toThrow('outside the configured workspace root')
  })

  it('glob excludes files reached via symlinked directories outside root', async () => {
    const workspaceRoot = await createTempDir('glob-symlink-root-')
    const outsideRoot = await createTempDir('glob-symlink-outside-')

    // Create a file inside the workspace and one outside
    const legitFile = path.join(workspaceRoot, 'legit.txt')
    const secretFile = path.join(outsideRoot, 'secret.txt')
    await fs.writeFile(legitFile, 'legit')
    await fs.writeFile(secretFile, 'secret')

    // Create a symlink inside workspace pointing to the outside directory
    await fs.symlink(outsideRoot, path.join(workspaceRoot, 'escape-dir'))

    // Mock ripgrep to return both files (simulating --follow traversing the symlink)
    vi.spyOn(types, 'runRipgrep').mockResolvedValue({
      ok: true,
      stdout: [legitFile, secretFile].join('\n'),
      stderr: '',
      exitCode: 0
    })

    const result = await globTool({ pattern: '*.txt' }, workspaceRoot)
    const content = result.content[0]
    expect(content.type).toBe('text')
    if (content.type !== 'text') throw new Error('Expected text content')
    const text = content.text

    expect(text).toContain('legit.txt')
    expect(text).not.toContain('secret.txt')
  })

  it('ls excludes symlinked directories outside root in recursive mode', async () => {
    const workspaceRoot = await createTempDir('ls-symlink-root-')
    const outsideRoot = await createTempDir('ls-symlink-outside-')

    await fs.writeFile(path.join(workspaceRoot, 'legit.txt'), 'legit')
    await fs.mkdir(path.join(outsideRoot, 'private'))
    await fs.writeFile(path.join(outsideRoot, 'private', 'secret.txt'), 'secret')

    // Create a symlink inside workspace pointing to the outside directory
    await fs.symlink(outsideRoot, path.join(workspaceRoot, 'escape-dir'))

    const result = await lsTool({ recursive: true }, workspaceRoot)
    const content = result.content[0]
    expect(content.type).toBe('text')
    if (content.type !== 'text') throw new Error('Expected text content')
    const text = content.text

    expect(text).toContain('legit.txt')
    // The symlink entry itself may appear, but its children should not be listed
    expect(text).not.toContain('secret.txt')
  })

  describe('ls reports why a path cannot be listed instead of calling it empty', () => {
    it('rejects a directory that does not exist', async () => {
      const workspaceRoot = await createTempDir('ls-missing-root-')
      const missing = path.join(workspaceRoot, 'does-not-exist')

      await expect(lsTool({ path: missing }, workspaceRoot)).rejects.toThrow('Directory not found')
    })

    it('rejects a file path', async () => {
      const workspaceRoot = await createTempDir('ls-file-root-')
      const filePath = path.join(workspaceRoot, 'note.txt')
      await fs.writeFile(filePath, 'not a directory')

      await expect(lsTool({ path: filePath }, workspaceRoot)).rejects.toThrow('Path is not a directory')
    })

    it('still lists a real empty directory as empty', async () => {
      const workspaceRoot = await createTempDir('ls-empty-root-')
      await fs.mkdir(path.join(workspaceRoot, 'empty-dir'))

      const result = await lsTool({ path: path.join(workspaceRoot, 'empty-dir') }, workspaceRoot)

      expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('(empty directory)') })
    })
  })

  describe('write/edit/delete/read reject escapes before mutating the filesystem', () => {
    const ESCAPE_ERROR = 'outside the configured workspace root'

    it('write rejects ../escape and a symlink pointing outside the root', async () => {
      const workspaceRoot = await createTempDir('write-escape-root-')
      const outsideRoot = await createTempDir('write-escape-outside-')
      const outsideFile = path.join(outsideRoot, 'target.txt')
      await fs.writeFile(outsideFile, 'original')

      await expect(writeTool({ file_path: '../escape.txt', content: 'pwned' }, workspaceRoot)).rejects.toThrow(
        ESCAPE_ERROR
      )
      // No file leaked into the parent of the workspace root.
      await expect(fs.stat(path.join(path.dirname(workspaceRoot), 'escape.txt'))).rejects.toMatchObject({
        code: 'ENOENT'
      })

      // Symlink inside the workspace pointing outside it must be rejected before writing.
      const symlinkPath = path.join(workspaceRoot, 'escape-link')
      await fs.symlink(outsideFile, symlinkPath)
      await expect(writeTool({ file_path: 'escape-link', content: 'pwned' }, workspaceRoot)).rejects.toThrow(
        ESCAPE_ERROR
      )
      await expect(fs.readFile(outsideFile, 'utf-8')).resolves.toBe('original')
    })

    it.skipIf(process.platform === 'win32')('write rejects a dangling symlink pointing outside the root', async () => {
      const workspaceRoot = await createTempDir('write-dangling-root-')
      const outsideRoot = await createTempDir('write-dangling-outside-')
      const outsideFile = path.join(outsideRoot, 'missing.txt')
      await fs.symlink(outsideFile, path.join(workspaceRoot, 'dangling-link'))

      await expect(writeTool({ file_path: 'dangling-link', content: 'pwned' }, workspaceRoot)).rejects.toThrow(
        ESCAPE_ERROR
      )
      await expect(fs.stat(outsideFile)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('write still creates a new file below a missing directory inside the root', async () => {
      const workspaceRoot = await createTempDir('write-new-nested-root-')

      await writeTool({ file_path: 'nested/new.txt', content: 'ok' }, workspaceRoot)
      await expect(fs.readFile(path.join(workspaceRoot, 'nested', 'new.txt'), 'utf-8')).resolves.toBe('ok')
    })

    it('write rejects a new file below a dangling directory symlink pointing outside the root', async () => {
      const workspaceRoot = await createTempDir('write-dangling-dir-root-')
      const outsideRoot = await createTempDir('write-dangling-dir-outside-')
      const outsideDir = path.join(outsideRoot, 'missing-dir')
      await fs.symlink(
        outsideDir,
        path.join(workspaceRoot, 'dangling-dir'),
        process.platform === 'win32' ? 'junction' : 'dir'
      )

      await expect(writeTool({ file_path: 'dangling-dir/new.txt', content: 'pwned' }, workspaceRoot)).rejects.toThrow(
        ESCAPE_ERROR
      )
      await expect(fs.stat(outsideDir)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it.skipIf(process.platform === 'win32')(
      'edit rejects creating a file through a dangling symlink pointing outside the root',
      async () => {
        const workspaceRoot = await createTempDir('edit-dangling-root-')
        const outsideRoot = await createTempDir('edit-dangling-outside-')
        const outsideFile = path.join(outsideRoot, 'missing.txt')
        await fs.symlink(outsideFile, path.join(workspaceRoot, 'dangling-link'))

        await expect(
          editTool({ file_path: 'dangling-link', old_string: '', new_string: 'pwned' }, workspaceRoot)
        ).rejects.toThrow(ESCAPE_ERROR)
        await expect(fs.stat(outsideFile)).rejects.toMatchObject({ code: 'ENOENT' })
      }
    )

    it('edit rejects ../escape and a symlink pointing outside the root', async () => {
      const workspaceRoot = await createTempDir('edit-escape-root-')
      const outsideRoot = await createTempDir('edit-escape-outside-')
      const outsideFile = path.join(outsideRoot, 'target.txt')
      await fs.writeFile(outsideFile, 'original')

      await expect(
        editTool({ file_path: '../target.txt', old_string: 'original', new_string: 'pwned' }, workspaceRoot)
      ).rejects.toThrow(ESCAPE_ERROR)
      await expect(fs.readFile(outsideFile, 'utf-8')).resolves.toBe('original')

      const symlinkPath = path.join(workspaceRoot, 'escape-link')
      await fs.symlink(outsideFile, symlinkPath)
      await expect(
        editTool({ file_path: 'escape-link', old_string: 'original', new_string: 'pwned' }, workspaceRoot)
      ).rejects.toThrow(ESCAPE_ERROR)
      await expect(fs.readFile(outsideFile, 'utf-8')).resolves.toBe('original')
    })

    it('delete rejects ../escape and a symlink pointing outside the root', async () => {
      const workspaceRoot = await createTempDir('delete-escape-root-')
      const outsideRoot = await createTempDir('delete-escape-outside-')
      const outsideFile = path.join(outsideRoot, 'target.txt')
      await fs.writeFile(outsideFile, 'keep-me')

      await expect(deleteTool({ path: '../target.txt' }, workspaceRoot)).rejects.toThrow(ESCAPE_ERROR)
      await expect(fs.readFile(outsideFile, 'utf-8')).resolves.toBe('keep-me')

      const symlinkPath = path.join(workspaceRoot, 'escape-link')
      await fs.symlink(outsideFile, symlinkPath)
      await expect(deleteTool({ path: 'escape-link' }, workspaceRoot)).rejects.toThrow(ESCAPE_ERROR)
      // Both the symlink and its target must survive.
      await expect(fs.readFile(outsideFile, 'utf-8')).resolves.toBe('keep-me')
    })

    it('read rejects ../escape and a symlink pointing outside the root', async () => {
      const workspaceRoot = await createTempDir('read-escape-root-')
      const outsideRoot = await createTempDir('read-escape-outside-')
      const outsideFile = path.join(outsideRoot, 'secret.txt')
      await fs.writeFile(outsideFile, 'top-secret')

      await expect(readTool({ file_path: '../secret.txt' }, workspaceRoot)).rejects.toThrow(ESCAPE_ERROR)

      const symlinkPath = path.join(workspaceRoot, 'escape-link')
      await fs.symlink(outsideFile, symlinkPath)
      await expect(readTool({ file_path: 'escape-link' }, workspaceRoot)).rejects.toThrow(ESCAPE_ERROR)
    })
  })

  describe('edit replacement fidelity', () => {
    // String.prototype.replaceAll interprets `$`-patterns in its replacement
    // argument, so a literal `$&`, `$'`, `$`` or `$$` in new_string is rewritten
    // to the matched text / surrounding text instead of being written verbatim.
    // The single-match path builds the result by hand and keeps them literal,
    // so replace_all must agree with it.
    const DOLLAR_CASES = [
      ['$& (matched text)', 'job $& done'],
      ["$' (text after the match)", "job $' done"],
      ['$` (text before the match)', 'job $` done'],
      ['$$ (literal dollar)', 'cost $$5'],
      ['$1 (no capture group in play)', 'arg $1 here'],
      ['plain $ in shell', 'echo $HOME']
    ] as const

    it.each(DOLLAR_CASES)('replace_all writes %s verbatim', async (_label, newString) => {
      const workspaceRoot = await createTempDir('edit-dollar-')
      const target = path.join(workspaceRoot, 'script.sh')
      await fs.writeFile(target, 'line TARGET\nline TARGET\n', 'utf-8')

      await editTool(
        { file_path: 'script.sh', old_string: 'TARGET', new_string: newString, replace_all: true },
        workspaceRoot
      )

      await expect(fs.readFile(target, 'utf-8')).resolves.toBe(`line ${newString}\nline ${newString}\n`)
    })

    it('replace_all and single replace agree on the same new_string', async () => {
      const newString = 'job $& $1 $$ done'

      const allRoot = await createTempDir('edit-agree-all-')
      await fs.writeFile(path.join(allRoot, 'f.txt'), 'TARGET\n', 'utf-8')
      await editTool({ file_path: 'f.txt', old_string: 'TARGET', new_string: newString, replace_all: true }, allRoot)
      const viaReplaceAll = await fs.readFile(path.join(allRoot, 'f.txt'), 'utf-8')

      const oneRoot = await createTempDir('edit-agree-one-')
      await fs.writeFile(path.join(oneRoot, 'f.txt'), 'TARGET\n', 'utf-8')
      await editTool({ file_path: 'f.txt', old_string: 'TARGET', new_string: newString }, oneRoot)
      const viaSingle = await fs.readFile(path.join(oneRoot, 'f.txt'), 'utf-8')

      expect(viaReplaceAll).toBe(viaSingle)
      expect(viaReplaceAll).toBe(`${newString}\n`)
    })
  })

  describe('edit empty fuzzy candidates', () => {
    // A whitespace-only old_string survives as an empty fuzzy candidate:
    // TrimmedBoundaryReplacer trims it to '' and content.includes('') is
    // always true, so indexOf('') === 0 "finds" it. replace_all would then
    // write new_string between every character (an empty match is never a real
    // edit); the single-match path only escaped that because
    // indexOf('') !== lastIndexOf('') skipped the candidate. Neither path
    // should ever consume an empty candidate.
    async function editInWorkspace(content: string, oldString: string, replaceAll: boolean) {
      const root = await createTempDir('edit-empty-')
      await fs.writeFile(path.join(root, 'f.txt'), content, 'utf-8')
      await editTool({ file_path: 'f.txt', old_string: oldString, new_string: 'X', replace_all: replaceAll }, root)
      return fs.readFile(path.join(root, 'f.txt'), 'utf-8')
    }

    it('replace_all reports not-found instead of interleaving new_string between characters', async () => {
      await expect(editInWorkspace('line1\nline2\n', '   \n  ', true)).rejects.toThrow(
        'old_string not found in content'
      )
    })

    it('single replace reports not-found for the same whitespace-only old_string', async () => {
      await expect(editInWorkspace('line1\nline2\n', '   ', false)).rejects.toThrow('old_string not found in content')
    })

    it('still replaces a whitespace old_string that literally appears', async () => {
      await expect(editInWorkspace('a\n   \nb\n', '   ', true)).resolves.toBe('a\nX\nb\n')
    })
  })

  describe('same-file mutation safety', () => {
    it('serializes concurrent edits for the same file so both changes land', async () => {
      const workspaceRoot = await createTempDir('edit-serialization-root-')
      const filePath = path.join(workspaceRoot, 'recipe.py')
      await fs.writeFile(filePath, 'value = 1\ncount = 3\n')

      const originalWriteFile = fs.writeFile.bind(fs)
      let delayedFirstWrite = false
      vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
        const [targetPath] = args
        if (!delayedFirstWrite && typeof targetPath === 'string' && targetPath === filePath) {
          delayedFirstWrite = true
          await new Promise((resolve) => setTimeout(resolve, 30))
        }
        return (
          originalWriteFile as (...writeArgs: Parameters<typeof fs.writeFile>) => ReturnType<typeof fs.writeFile>
        )(...args)
      })

      await Promise.all([
        handleEditTool({ file_path: 'recipe.py', old_string: 'value = 1', new_string: 'value = 2' }, workspaceRoot),
        handleEditTool({ file_path: 'recipe.py', old_string: 'count = 3', new_string: 'count = 4' }, workspaceRoot)
      ])

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('value = 2')
      expect(content).toContain('count = 4')
    })

    it('fails write when post-write verification detects mismatched content', async () => {
      const workspaceRoot = await createTempDir('write-verify-root-')
      const filePath = path.join(workspaceRoot, 'verify.txt')
      await fs.writeFile(filePath, 'before')

      const originalWriteFile = fs.writeFile.bind(fs)
      vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
        const [targetPath, content] = args
        if (typeof targetPath === 'string' && targetPath === filePath && content === 'after') {
          return
        }
        return (
          originalWriteFile as (...writeArgs: Parameters<typeof fs.writeFile>) => ReturnType<typeof fs.writeFile>
        )(...args)
      })

      await expect(handleWriteTool({ file_path: 'verify.txt', content: 'after' }, workspaceRoot)).rejects.toThrow(
        'Post-write verification failed'
      )
      await expect(fs.readFile(filePath, 'utf-8')).resolves.toBe('before')
    })

    it('preserves call order for dependent edits when the first validation is slower', async () => {
      const workspaceRoot = await createTempDir('edit-ordering-root-')
      const filePath = path.join(workspaceRoot, 'chain.txt')
      await fs.writeFile(filePath, 'a')

      const originalRealpath = fs.realpath.bind(fs)
      let delayedFirstValidation = false
      vi.spyOn(fs, 'realpath').mockImplementation(async (...args: Parameters<typeof fs.realpath>) => {
        if (!delayedFirstValidation) {
          delayedFirstValidation = true
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        return (
          originalRealpath as (...realpathArgs: Parameters<typeof fs.realpath>) => ReturnType<typeof fs.realpath>
        )(...args)
      })

      await Promise.all([
        handleEditTool({ file_path: 'chain.txt', old_string: 'a', new_string: 'b' }, workspaceRoot),
        handleEditTool({ file_path: 'chain.txt', old_string: 'b', new_string: 'c' }, workspaceRoot)
      ])

      await expect(fs.readFile(filePath, 'utf-8')).resolves.toBe('c')
    })

    it('serializes delete with an in-flight edit on the same path', async () => {
      const workspaceRoot = await createTempDir('delete-serialization-root-')
      const filePath = path.join(workspaceRoot, 'target.txt')
      await fs.writeFile(filePath, 'original')

      let releaseEditWrite!: () => void
      const editWriteGate = new Promise<void>((resolve) => {
        releaseEditWrite = resolve
      })
      let editWriteStarted!: () => void
      const editWriteStartedGate = new Promise<void>((resolve) => {
        editWriteStarted = resolve
      })
      const originalWriteFile = fs.writeFile.bind(fs)
      let editWritesSeen = 0
      vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
        const [targetPath] = args
        if (typeof targetPath === 'string' && targetPath === filePath) {
          editWritesSeen += 1
          if (editWritesSeen === 1) {
            editWriteStarted()
            await editWriteGate
          }
        }
        return (
          originalWriteFile as (...writeArgs: Parameters<typeof fs.writeFile>) => ReturnType<typeof fs.writeFile>
        )(...args)
      })

      const editPromise = handleEditTool(
        { file_path: 'target.txt', old_string: 'original', new_string: 'edited' },
        workspaceRoot
      )
      await editWriteStartedGate

      let deleteFinished = false
      const deletePromise = handleDeleteTool({ path: 'target.txt' }, workspaceRoot).then((result) => {
        deleteFinished = true
        return result
      })

      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(deleteFinished).toBe(false)

      releaseEditWrite()
      await Promise.all([editPromise, deletePromise])
      await expect(fs.stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })
})
