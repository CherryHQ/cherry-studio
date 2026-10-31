import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertCurrentPlan,
  changedFiles,
  contentTree,
  entries,
  filesForCommit,
  git,
  mergeContent,
  overlayContent,
  prAction,
  scratch,
  sha,
  validatePlan
} from './content.mjs'
import { baselineTree } from './sync.mjs'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function fixture() {
  const work = scratch()
  cleanups.push(work.close)
  const tree = (files: Record<string, string | Buffer>, prefix = ''): string => {
    const records: string[] = []
    const directories = new Set<string>()
    for (const [name, bytes] of Object.entries(files)) {
      if (!name.startsWith(prefix)) continue
      const relative = name.slice(prefix.length)
      if (relative.includes('/')) {
        directories.add(relative.split('/')[0])
        continue
      }
      const oid = git(work.repo, ['hash-object', '-w', '--stdin'], bytes).toString().trim()
      records.push(`100644 blob ${oid}\t${relative}\0`)
    }
    for (const directory of directories)
      records.push(`040000 tree ${tree(files, `${prefix}${directory}/`)}\t${directory}\0`)
    return git(work.repo, ['mktree', '-z'], records.join('')).toString().trim()
  }
  const text = (oid: string, name: string) => git(work.repo, ['show', `${oid}:${name}`]).toString()
  return { ...work, tree, text }
}

const source = {
  'content/SUMMARY.md': '# Contents\n',
  'content/page.md': 'start\n\n1\n2\n3\n4\n5\n6\n7\n8\n\nend\n',
  'locales.json': '[]\n',
  'page-aliases.json': '{}\n'
}

describe('documentation reconciliation', () => {
  it('retains independent edits instead of copying one side over the other', () => {
    const f = fixture()
    const base = f.tree(source)
    const left = f.tree({ ...source, 'content/page.md': source['content/page.md'].replace('start', 'desktop') })
    const right = f.tree({ ...source, 'content/page.md': source['content/page.md'].replace('end', 'website') })
    const merged = mergeContent(f.repo, base, left, right)
    expect(merged.conflicts).toEqual([])
    expect(f.text(merged.tree, 'content/page.md')).toBe(
      source['content/page.md'].replace('start', 'desktop').replace('end', 'website')
    )
  })

  it('converges identical edits and repeated import events without another diff', () => {
    const f = fixture()
    const base = f.tree(source)
    const updated = f.tree({ ...source, 'content/new.md': 'new page\n' })
    expect(mergeContent(f.repo, base, updated, updated)).toEqual({ tree: updated, conflicts: [] })
    expect(mergeContent(f.repo, updated, updated, updated)).toEqual({ tree: updated, conflicts: [] })
    expect(changedFiles(f.repo, updated, updated)).toEqual([])
  })

  it.each(['text', 'binary', 'delete-edit', 'add-add'])('blocks a whole batch for a %s conflict', (kind) => {
    const f = fixture()
    const bytes = kind === 'binary' ? Buffer.from([0, 1, 2]) : 'base\n'
    const baseFiles = { ...source, ...(kind === 'add-add' ? {} : { 'content/conflict': bytes }) }
    const base = f.tree(baseFiles)
    const left = f.tree({
      ...baseFiles,
      ...(kind === 'delete-edit' ? {} : { 'content/conflict': kind === 'binary' ? Buffer.from([0, 9]) : 'desktop\n' }),
      'content/independent.md': 'keep\n'
    })
    const actualLeft =
      kind === 'delete-edit'
        ? f.tree(
            Object.fromEntries(
              Object.entries({ ...baseFiles, 'content/independent.md': 'keep\n' }).filter(
                ([name]) => name !== 'content/conflict'
              )
            )
          )
        : left
    const right = f.tree({ ...baseFiles, 'content/conflict': kind === 'binary' ? Buffer.from([0, 8]) : 'website\n' })
    const result = mergeContent(f.repo, base, actualLeft, right)
    expect(result.conflicts).toContain('content/conflict')
    expect(f.text(base, 'content/page.md')).toBe(source['content/page.md'])
    expect(f.text(right, 'content/conflict')).toBe(kind === 'binary' ? '\0\b' : 'website\n')
  })

  it('keeps navigation additions, binary additions and deletions from both directions', () => {
    const f = fixture()
    const base = f.tree(source)
    const leftFiles: Record<string, string> = {
      ...source,
      'content/SUMMARY.md': '- [New](new.md)\n',
      'content/new.md': 'new\n'
    }
    delete leftFiles['content/page.md']
    const right = f.tree({ ...source, 'content/assets/image.webp': Buffer.from([0, 3, 255]) })
    const result = mergeContent(f.repo, base, f.tree(leftFiles), right)
    expect(result.conflicts).toEqual([])
    expect(entries(f.repo, result.tree).map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['content/new.md', 'content/assets/image.webp'])
    )
    expect(entries(f.repo, result.tree).map((entry) => entry.name)).not.toContain('content/page.md')
    const changes = filesForCommit(f.repo, changedFiles(f.repo, base, result.tree), 'website')
    expect(changes.deletions).toEqual([{ path: 'docs-site/content/page.md' }])
    expect(
      changes.additions.find(
        (entry: { path: string; contents: string }) => entry.path === 'docs-site/content/assets/image.webp'
      )?.contents
    ).toBe(Buffer.from([0, 3, 255]).toString('base64'))
  })

  it('reports a file/directory replacement conflict without choosing either shape', () => {
    const f = fixture()
    const base = f.tree(source)
    const desktop = f.tree({ ...source, 'content/new': 'file' })
    const website = f.tree({ ...source, 'content/new/child.md': 'directory' })
    const result = mergeContent(f.repo, base, desktop, website)
    expect(result.conflicts.some((name) => name.startsWith('content/new'))).toBe(true)
    expect(f.text(desktop, 'content/new')).toBe('file')
    expect(f.text(website, 'content/new/child.md')).toBe('directory')
  })

  it('maps only shared content, including optional legacy configuration', () => {
    const f = fixture()
    const desktop = f.tree({
      ...Object.fromEntries(Object.entries(source).map(([name, value]) => [`website-docs/${name}`, value])),
      'website-docs/README.md': 'local editing instructions',
      'src/app.ts': 'desktop'
    })
    const website = f.tree({
      ...Object.fromEntries(Object.entries(source).map(([name, value]) => [`docs-site/${name}`, value])),
      'docs-site/src/page.tsx': 'website rendering',
      'docs-site/public/models-search/en.json': 'website generated data'
    })
    expect(contentTree(f.repo, desktop, 'desktop')).toBe(contentTree(f.repo, website, 'website'))
    expect(contentTree(f.repo, desktop, 'desktop')).toBe(f.tree(source))
    expect(() => contentTree(f.repo, f.tree({ 'website-docs/README.md': 'not imported' }), 'desktop')).toThrow(
      'Missing documentation source'
    )
  })

  it('does not accept a corrupt or one-sided checkpoint as the shared baseline', () => {
    const f = fixture()
    const desktop = f.tree(
      Object.fromEntries(Object.entries(source).map(([name, value]) => [`website-docs/${name}`, value]))
    )
    const website = f.tree(
      Object.fromEntries(Object.entries(source).map(([name, value]) => [`docs-site/${name}`, value]))
    )
    const state = { version: 1, heads: { desktop, website }, tree: f.tree(source) }
    expect(baselineTree(f.repo, state)).toBe(state.tree)
    expect(() => baselineTree(f.repo, { ...state, tree: '0'.repeat(40) })).toThrow('baseline trees disagree')
  })
})

describe('synchronization PR lifecycle', () => {
  const old = 'a'.repeat(40)
  const next = 'b'.repeat(40)
  const result = 'c'.repeat(40)
  const plan = {
    version: 1,
    destination: 'desktop',
    baseline: old,
    heads: { desktop: old, website: next },
    trees: { desktop: old, website: next },
    result
  }

  it('rejects revisions and destinations outside the fixed plan schema', () => {
    expect(() => sha('main; echo secret')).toThrow('full Git SHA')
    expect(() => validatePlan({ ...plan, destination: '../other-repo' })).toThrow('Invalid synchronization plan')
    expect(() => validatePlan({ ...plan, heads: { desktop: 'main', website: next } })).toThrow('full Git SHA')
  })

  it('allows a partial import to finish but rejects unseen mapped content', () => {
    expect(() => assertCurrentPlan(plan, { desktop: old, website: next })).not.toThrow()
    expect(() => assertCurrentPlan(plan, { desktop: result, website: next })).not.toThrow()
    expect(() => assertCurrentPlan(plan, { desktop: result, website: result })).not.toThrow()
    expect(() => assertCurrentPlan(plan, { desktop: 'd'.repeat(40), website: next })).toThrow(
      'Stale documentation plan: desktop'
    )
  })

  it('preserves manually edited branches and deliberate pauses', () => {
    const pr = { state: 'open', head: { sha: next } }
    expect(prAction(pr, old, false)).toBe('manual')
    expect(prAction(pr, next, false)).toBe('update')
    expect(prAction({ ...pr, state: 'closed' }, next, false)).toBe('paused')
    expect(prAction({ ...pr, state: 'closed' }, next, true)).toBe('create')
    expect(prAction({ ...pr, state: 'closed', merged_at: '2026-10-31' }, next, false)).toBe('create')
    expect(
      prAction(
        { ...pr, state: 'closed', body: 'Closed by the coordinator: shared content has converged.' },
        next,
        false
      )
    ).toBe('create')
  })
})

describe('isolated renderer content', () => {
  function directories() {
    const root = mkdtempSync(path.join(tmpdir(), 'cherry-docs-overlay-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const input = path.join(root, 'input')
    const output = path.join(root, 'output')
    mkdirSync(path.join(input, 'content'), { recursive: true })
    mkdirSync(path.join(output, 'content'), { recursive: true })
    writeFileSync(path.join(input, 'locales.json'), '[]')
    writeFileSync(path.join(input, 'page-aliases.json'), '{}')
    return { root, input, output }
  }

  it('previews untracked candidate changes and deletions while retaining website-only files', () => {
    const { input, output } = directories()
    writeFileSync(path.join(input, 'content/new.md'), 'candidate text')
    writeFileSync(path.join(output, 'content/removed.md'), 'stale')
    writeFileSync(path.join(output, 'shadowed-baseline.json'), 'stale legacy config')
    writeFileSync(path.join(output, 'renderer.ts'), 'website-only')
    overlayContent(input, output)
    expect(readFileSync(path.join(output, 'content/new.md'), 'utf8')).toBe('candidate text')
    expect(() => readFileSync(path.join(output, 'content/removed.md'))).toThrow()
    expect(() => readFileSync(path.join(output, 'shadowed-baseline.json'))).toThrow()
    expect(readFileSync(path.join(output, 'renderer.ts'), 'utf8')).toBe('website-only')
    expect(readFileSync(path.join(input, 'content/new.md'), 'utf8')).toBe('candidate text')
  })

  it('rejects a symlink instead of reading outside the candidate content root', () => {
    const { root, input, output } = directories()
    const outside = path.join(root, 'private')
    writeFileSync(outside, 'private')
    symlinkSync(outside, path.join(input, 'content/link.md'))
    expect(() => overlayContent(input, output)).toThrow('Unsupported content type')
  })
})
