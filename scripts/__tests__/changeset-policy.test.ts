import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const script = path.resolve(import.meta.dirname, '../release/check-changesets.mjs')
let root: string

function write(file: string, content: string) {
  const target = path.join(root, file)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function configure(ignore = ['@cherrystudio/ui']) {
  write('.changeset/config.json', JSON.stringify({ ignore }))
}

function git(...args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
}

function commit() {
  git('add', '.')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--no-gpg-sign', '-m', 'fixture')
}

function check(base?: string) {
  return spawnSync(process.execPath, [script, ...(base ? ['--base', base] : [])], { cwd: root, encoding: 'utf8' })
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'changeset-policy-'))
  write('package.json', JSON.stringify({ name: 'fixture', private: true }))
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  for (const name of ['ui', 'web-search']) {
    write(`packages/${name}/package.json`, JSON.stringify({ name: `@cherrystudio/${name}`, version: '1.0.0' }))
  }
  configure()
  git('init', '--quiet')
  commit()
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('changeset release policy', () => {
  it('rejects the ignored-only changeset that otherwise survives every version PR', () => {
    write('.changeset/voice-content-consumers.md', "---\n'@cherrystudio/ui': patch\n---\n\nVoice controls.\n")

    const result = check()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('.changeset/voice-content-consumers.md')
    expect(result.stderr).toContain('ignored packages: @cherrystudio/ui')
  })

  it('rejects ignored changesets even when another file contains a real release', () => {
    write('.changeset/ignored.md', "---\n'@cherrystudio/ui': patch\n---\n\nUI.\n")
    write('.changeset/publish.md', "---\n'@cherrystudio/web-search': minor\n---\n\nSearch.\n")

    const result = check()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('.changeset/ignored.md references ignored packages: @cherrystudio/ui')
  })

  it('rejects a changeset mixing ignored and published packages', () => {
    write('.changeset/mixed.md', "---\n'@cherrystudio/ui': patch\n'@cherrystudio/web-search': patch\n---\n\nUpdate.\n")

    const result = check()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('.changeset/mixed.md references ignored packages: @cherrystudio/ui')
  })

  it('uses Changesets ignore glob semantics', () => {
    configure(['@cherrystudio/*'])
    write('.changeset/search.md', "---\n'@cherrystudio/web-search': patch\n---\n\nSearch.\n")

    const result = check()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ignored packages: @cherrystudio/web-search')
  })

  it('accepts a publishable changeset', () => {
    write('.changeset/search.md', "---\n'@cherrystudio/web-search': patch\n---\n\nSearch.\n")

    expect(check().status).toBe(0)
  })

  it('rejects private packages even when private package versioning is enabled', () => {
    write('.changeset/config.json', JSON.stringify({ privatePackages: { version: true, tag: true } }))
    write('packages/ui/package.json', JSON.stringify({ name: '@cherrystudio/ui', version: '1.0.0', private: true }))
    write('.changeset/private.md', "---\n'@cherrystudio/ui': patch\n---\n\nInternal.\n")

    const result = check()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('private package: @cherrystudio/ui')
  })

  it('rejects unknown packages', () => {
    write('.changeset/unknown.md', "---\n'@cherrystudio/typo': patch\n---\n\nTypo.\n")

    const result = check()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unknown package: @cherrystudio/typo')
  })

  it('rejects a new changeset for an unchanged package', () => {
    write('.changeset/search.md', "---\n'@cherrystudio/web-search': patch\n---\n\nSearch.\n")
    write('packages/web-search-other/index.ts', 'export {}')

    const result = check('HEAD')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unchanged package: @cherrystudio/web-search')
  })

  it.each(['untracked', 'staged', 'committed'])('accepts a package with %s changes', (state) => {
    write('.changeset/search.md', "---\n'@cherrystudio/web-search': patch\n---\n\nSearch.\n")
    write('packages/web-search/search.ts', 'export const search = true')
    git('branch', 'base')
    if (state === 'staged') git('add', '.')
    if (state === 'committed') commit()

    expect(check('base').status).toBe(0)
  })

  it('rejects edits to an existing changeset for an unchanged package', () => {
    write('.changeset/search.md', "---\n'@cherrystudio/web-search': patch\n---\n\nSearch.\n")
    commit()
    write('.changeset/search.md', "---\n'@cherrystudio/web-search': minor\n---\n\nSearch again.\n")

    expect(check('HEAD').stderr).toContain('unchanged package: @cherrystudio/web-search')
  })

  it.each(['modified', 'deleted'])('accepts a package with an unstaged %s file', (state) => {
    write('packages/web-search/search.ts', 'export const search = true')
    commit()
    if (state === 'deleted') rmSync(path.join(root, 'packages/web-search/search.ts'))
    else write('packages/web-search/search.ts', 'export const search = false')
    write('.changeset/search.md', "---\n'@cherrystudio/web-search': patch\n---\n\nSearch.\n")

    expect(check('HEAD').status).toBe(0)
  })

  it('checks each package in a mixed changeset independently', () => {
    configure([])
    write('packages/web-search/search.ts', 'export {}')
    write('.changeset/mixed.md', "---\n'@cherrystudio/web-search': patch\n'@cherrystudio/ui': patch\n---\n\nUpdate.\n")

    const result = check('HEAD')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unchanged package: @cherrystudio/ui')
    expect(result.stderr).not.toContain('unchanged package: @cherrystudio/web-search')
  })

  it('supports workspace packages outside packages/*', () => {
    write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n  - native/speech\n')
    write('native/speech/package.json', JSON.stringify({ name: '@cherrystudio/speech', version: '0.1.0' }))
    write('.changeset/speech.md', "---\n'@cherrystudio/speech': patch\n---\n\nFirst release.\n")

    expect(check('HEAD').status).toBe(0)
  })

  it('allows pending changesets inherited from the base', () => {
    write('.changeset/search.md', "---\n'@cherrystudio/web-search': patch\n---\n\nSearch.\n")
    commit()
    write('.changeset/no-release.md', '---\n---\n')

    expect(check('HEAD').status).toBe(0)
  })

  it('fails when the comparison base cannot be resolved', () => {
    const result = check('missing-base')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('cannot resolve base')
  })

  it('allows intentionally empty changesets for changes needing no release', () => {
    write('.changeset/no-release.md', '---\n---\n')

    expect(check().status).toBe(0)
  })

  it('allows the consumed state so the action can enter npm publication', () => {
    write('.changeset/README.md', '# Changesets\n')

    expect(check().status).toBe(0)
  })

  it('fails closed on invalid Changesets configuration', () => {
    write('.changeset/config.json', JSON.stringify({ ignore: true }))

    const result = check()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ignore')
  })

  it('rejects malformed changesets instead of silently treating them as empty', () => {
    write('.changeset/broken.md', 'Missing frontmatter\n')

    const result = check()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('could not parse changeset')
  })

  it('gates both CI (including version PRs) and release automation before creating PRs or publishing', () => {
    const repo = path.resolve(import.meta.dirname, '../..')
    const manifest = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'))
    expect(manifest.scripts['changeset:check']).toBe('node scripts/release/check-changesets.mjs')

    for (const [file, job] of [
      ['ci.yml', 'basic-checks'],
      ['release-packages.yml', 'release']
    ]) {
      const workflow = parse(readFileSync(path.join(repo, '.github/workflows', file), 'utf8'))
      const steps = workflow.jobs[job].steps
      const guardIndex = steps.findIndex((step: { run?: string }) => step.run?.includes('pnpm changeset:check'))
      expect(guardIndex).toBeGreaterThanOrEqual(0)
      const guard = steps[guardIndex]
      expect(guard['continue-on-error']).toBeUndefined()
      if (file === 'ci.yml') {
        expect(guard.if).toBe("needs.changes.outputs.repository == 'true'")
        expect(guard.env.BASE_REF).toBe('${{ github.event.pull_request.base.ref }}')
        expect(guard.run).toContain('pnpm changeset:check --base "origin/$BASE_REF"')
      } else {
        expect(guard.if).toBeUndefined()
        expect(guardIndex).toBeLessThan(steps.findIndex((step: { id?: string }) => step.id === 'changesets'))
      }
    }
  })
})
