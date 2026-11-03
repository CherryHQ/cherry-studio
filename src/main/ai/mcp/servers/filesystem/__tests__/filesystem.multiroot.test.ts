import fs from 'fs/promises'
import path from 'path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

import { callBuiltinTool, toolText } from '../../__tests__/builtinMcpClient'
import { createBuiltinMcpEndpoint } from '../../factory'
import * as types from '../types'

const dirs: string[] = []
async function fixture() {
  const parent = path.join(process.cwd(), '.context', 'vitest-temp')
  await fs.mkdir(parent, { recursive: true })
  const dir = await fs.mkdtemp(path.join(parent, 'multiroot-'))
  dirs.push(dir)
  const roots = ['a', 'b', 'c'].map((name) => path.join(dir, name))
  await Promise.all(roots.map((root) => fs.mkdir(root)))
  return { dir, roots }
}
async function call(roots: string[], name: string, args: Record<string, unknown>, envs: Record<string, string> = {}) {
  const endpoint = await createBuiltinMcpEndpoint(BuiltinMcpServerNames.filesystem, roots, envs)
  try {
    const result = await callBuiltinTool(endpoint.createServer, name, args)
    if (result.isError) throw new Error(toolText(result))
    return toolText(result)
  } finally {
    await endpoint.close()
  }
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('filesystem multiple roots', () => {
  it.each([false, true])('serves every root with reversed order %s', async (reverse) => {
    const { roots } = await fixture()
    const configured = reverse ? [...roots].reverse() : roots
    for (const root of roots) {
      const file = path.join(root, 'marker.txt')
      await fs.writeFile(file, 'unique needle')
      expect(await call(configured, 'ls', { path: root })).toContain('marker.txt')
      expect(await call(configured, 'read', { file_path: file })).toContain('unique needle')
      expect(
        await call(configured, 'write', { file_path: path.join(root, 'deep', 'new.txt'), content: 'created' })
      ).toContain('new.txt')
      expect(await fs.readFile(path.join(root, 'deep', 'new.txt'), 'utf8')).toBe('created')
      expect(
        await call(configured, 'edit', { file_path: file, old_string: 'unique', new_string: 'changed' })
      ).toContain('marker.txt')
      expect(await fs.readFile(file, 'utf8')).toBe('changed needle')
      vi.spyOn(types, 'runRipgrep').mockResolvedValue({ ok: true, stdout: file, stderr: '', exitCode: 0 })
      expect(await call(configured, 'glob', { path: root, pattern: '*.txt' })).toContain(file)
      vi.spyOn(types, 'runRipgrep').mockResolvedValue({ ok: false, stdout: '', stderr: '', exitCode: null })
      const grep = await call(configured, 'grep', { path: file, pattern: 'needle' })
      expect(grep).toContain(file)
      expect(grep).toContain('1: changed needle')
      expect(await call(configured, 'delete', { path: file })).toContain('marker.txt')
      await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
      vi.restoreAllMocks()
    }
  })
  it('defaults searches to the first valid root, including empty paths', async () => {
    const { roots } = await fixture()
    for (const [index, root] of roots.entries())
      await fs.writeFile(path.join(root, `sentinel${index}.txt`), `needle${index}`)
    const configured = ['relative', ...roots]
    for (const target of [undefined, '']) {
      const ls = await call(configured, 'ls', { path: target })
      expect(ls).toContain('sentinel0.txt')
      expect(ls).not.toContain('sentinel1.txt')
      vi.spyOn(types, 'runRipgrep').mockResolvedValue({
        ok: true,
        stdout: path.join(roots[0], 'sentinel0.txt'),
        stderr: '',
        exitCode: 0
      })
      expect(await call(configured, 'glob', { path: target, pattern: '*.txt' })).toContain('sentinel0.txt')
      vi.spyOn(types, 'runRipgrep').mockResolvedValue({ ok: false, stdout: '', stderr: '', exitCode: null })
      const grep = await call(configured, 'grep', { path: target, pattern: 'needle' })
      expect(grep).toContain('needle0')
      expect(grep).not.toContain('needle1')
    }
  })

  it('rejects all tools outside the trusted set without changing files', async () => {
    const { dir, roots } = await fixture()
    const outside = path.join(dir, 'outside.txt')
    await fs.writeFile(outside, 'unchanged')
    const cases: [string, Record<string, unknown>][] = [
      ['ls', { path: outside }],
      ['glob', { path: outside, pattern: '*' }],
      ['grep', { path: outside, pattern: 'x' }],
      ['read', { file_path: outside }],
      ['write', { file_path: outside, content: 'changed' }],
      ['edit', { file_path: outside, old_string: 'unchanged', new_string: 'changed' }],
      ['delete', { path: outside }]
    ]
    for (const [name, args] of cases)
      await expect(call(roots, name, args)).rejects.toThrow(
        `Access denied: Path is outside the configured workspace root: ${outside}`
      )
    const missing = path.join(dir, 'missing', 'deep', 'file')
    await expect(call(roots, 'write', { file_path: missing, content: 'x' })).rejects.toThrow('Access denied')
    await expect(fs.stat(path.join(dir, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(outside, 'utf8')).toBe('unchanged')
  })

  it.skipIf(process.platform === 'win32')('rejects escapes and dangling links in every root', async () => {
    const { dir, roots } = await fixture()
    const outside = path.join(dir, 'outside')
    await fs.mkdir(outside)
    for (const root of roots) {
      await fs.symlink(outside, path.join(root, 'link'))
      await fs.symlink(path.join(outside, 'missing'), path.join(root, 'dangling'))
      for (const target of [
        path.join(root, 'link', 'file'),
        path.join(root, 'dangling', 'file'),
        path.join(root, '..', 'outside', 'file')
      ]) {
        await expect(call(roots, 'write', { file_path: target, content: 'x' })).rejects.toThrow('Access denied')
        await expect(call(roots, 'edit', { file_path: target, old_string: '', new_string: 'x' })).rejects.toThrow(
          'Access denied'
        )
      }
    }
  })

  it('keeps relative paths paired with their root and accepts internal dot segments', async () => {
    const { roots } = await fixture()
    await fs.writeFile(path.join(roots[1], 'only.txt'), 'second')
    await expect(call(roots, 'read', { file_path: 'only.txt' })).rejects.toThrow('File not found')
    expect(await call(roots, 'read', { file_path: path.join(roots[1], 'only.txt') })).toContain('second')
    await fs.mkdir(path.join(roots[0], '..archive'))
    await fs.writeFile(path.join(roots[0], '..archive', 'file'), 'archive')
    await fs.writeFile(path.join(roots[0], 'file'), 'dot')
    expect(await call(roots, 'read', { file_path: 'sub/../file' })).toContain('dot')
    expect(await call(roots, 'read', { file_path: '..archive/file' })).toContain('archive')
  })

  it('honors workspace fallback and environment precedence', async () => {
    const { dir, roots } = await fixture()
    const workspace = path.join(dir, 'workspace')
    await fs.mkdir(workspace)
    await fs.writeFile(path.join(workspace, 'w'), 'workspace')
    await fs.writeFile(path.join(roots[1], 'b'), 'second')
    const original = application.getPath.bind(application)
    vi.spyOn(application, 'getPath').mockImplementation((key: string, ...args) =>
      key === 'feature.mcp.workspace' ? workspace : original(key as never, ...args)
    )
    for (const config of [[], [' ', ''], ['relative']])
      expect(await call(config, 'read', { file_path: 'w' })).toContain('workspace')
    expect(await call(['relative', roots[1]], 'read', { file_path: 'b' })).toContain('second')
    await expect(call(['relative', roots[1]], 'read', { file_path: path.join(workspace, 'w') })).rejects.toThrow(
      'Access denied'
    )
    expect(await call(roots, 'read', { file_path: 'b' }, { WORKSPACE_ROOT: roots[1] })).toContain('second')
    expect(await call(roots, 'read', { file_path: path.join(roots[1], 'b') }, { WORKSPACE_ROOT: ' ' })).toContain(
      'second'
    )
    expect(await call(roots, 'read', { file_path: 'w' }, { WORKSPACE_ROOT: 'relative' })).toContain('workspace')
  })

  it('filters traversal output and resolves relative grep results from process cwd', async () => {
    const { dir, roots } = await fixture()
    const good = path.join(roots[1], 'good.txt')
    const bad = path.join(dir, 'bad.txt')
    await fs.writeFile(good, 'marker needle')
    await fs.writeFile(bad, 'secret needle')
    vi.spyOn(types, 'runRipgrep').mockResolvedValue({
      ok: true,
      stdout: [good, bad].join('\n'),
      stderr: '',
      exitCode: 0
    })
    const glob = await call(roots, 'glob', { path: roots[1], pattern: '*' })
    expect(glob).toContain(good)
    expect(glob).not.toContain(bad)
    const match = (file: string, content: string) =>
      JSON.stringify({ type: 'match', data: { path: { text: file }, lines: { text: content }, line_number: 1 } })
    vi.spyOn(types, 'runRipgrep').mockResolvedValue({
      ok: true,
      stdout: [match(path.relative(process.cwd(), good), 'marker needle'), match(bad, 'secret needle')].join('\n'),
      stderr: '',
      exitCode: 0
    })
    const grep = await call(roots, 'grep', { path: roots[1], pattern: 'needle' })
    expect(grep).toContain(good)
    expect(grep).toContain('marker needle')
    expect(grep).not.toContain('secret needle')
    vi.spyOn(types, 'runRipgrep').mockResolvedValue({ ok: false, stdout: '', stderr: '', exitCode: null })
    expect(await call(roots, 'grep', { path: roots[1], pattern: 'needle' })).toContain('marker needle')
  })

  it('displays paths relative to the matching canonical root', async () => {
    const { roots } = await fixture()
    for (const root of roots.slice(1)) {
      const file = path.join(root, 'sub', 'file.txt')
      expect(await call(roots, 'write', { file_path: file, content: 'old' })).toContain('Created file: sub/file.txt')
      expect(await call(roots, 'read', { file_path: file })).toContain('File: sub/file.txt')
      expect(await call(roots, 'edit', { file_path: file, old_string: 'old', new_string: 'new' })).toContain(
        'Edited: sub/file.txt'
      )
      expect(await call(roots, 'edit', { file_path: file, old_string: '', new_string: 'overwrite' })).toContain(
        'Overwrote file: sub/file.txt'
      )
      expect(await call(roots, 'delete', { path: file })).toContain('File deleted: sub/file.txt')
      expect(await call(roots, 'edit', { file_path: file, old_string: '', new_string: 'create' })).toContain(
        'Created new file: sub/file.txt'
      )
    }
  })

  it.skipIf(process.platform === 'win32')(
    'supports overlapping and aliased roots and filters recursive traversal',
    async () => {
      const { dir, roots } = await fixture()
      const child = path.join(roots[0], 'child')
      await fs.mkdir(child)
      const file = path.join(child, 'file')
      await fs.writeFile(file, 'overlap')
      const alias = path.join(dir, 'alias')
      await fs.symlink(roots[0], alias, 'dir')
      for (const config of [
        [roots[0], child],
        [child, roots[0]],
        [alias, roots[0]],
        [roots[0], alias]
      ]) {
        expect(await call(config, 'read', { file_path: file })).toContain('overlap')
      }
      const outside = path.join(dir, 'outside')
      await fs.mkdir(outside)
      await fs.writeFile(path.join(outside, 'secret-child'), 'secret')
      await fs.symlink(outside, path.join(roots[1], 'escape'), 'dir')
      expect(await call(roots, 'ls', { path: roots[1], recursive: true })).not.toContain('secret-child')
    }
  )

  it('expands home and retains duplicate roots without changing authorization', async () => {
    const { dir, roots } = await fixture()
    await fs.writeFile(path.join(roots[1], 'file'), 'home marker')
    const original = application.getPath.bind(application)
    vi.spyOn(application, 'getPath').mockImplementation((key: string, ...args) =>
      key === 'sys.home' ? dir : original(key as never, ...args)
    )
    expect(await call(['~/b', roots[1], roots[1]], 'read', { file_path: 'file' })).toContain('home marker')
  })

  it('keeps equal filenames in separate roots distinct in grep results', async () => {
    const { roots } = await fixture()
    const files = roots.slice(1).map((root) => path.join(root, 'same.txt'))
    await fs.writeFile(files[0], 'first needle')
    await fs.writeFile(files[1], 'second needle')
    const match = (file: string, content: string) =>
      JSON.stringify({ type: 'match', data: { path: { text: file }, lines: { text: content }, line_number: 1 } })
    vi.spyOn(types, 'runRipgrep').mockResolvedValue({
      ok: true,
      stdout: [match(files[0], 'first needle'), match(files[1], 'second needle')].join('\n'),
      stderr: '',
      exitCode: 0
    })
    const result = await call(roots, 'grep', { path: roots[1], pattern: 'needle' })
    expect(result).toContain(`${files[0]}:`)
    expect(result).toContain(`${files[1]}:`)
    expect(result).toContain('first needle')
    expect(result).toContain('second needle')
  })
})
