import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/commandResolver', () => ({
  findExecutableInEnv: async (name: string) => (name === 'python3' ? '/usr/bin/python3' : null)
}))
vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: async () => ({ ...process.env }) }))

import { inspectSkillEnvironment, SAFE_PIP_REQUIREMENT, validateSetupRequirements } from '../skillEnvironment'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { force: true, recursive: true })
})

async function fixture(frontmatter: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'skill-preflight-'))
  directories.push(directory)
  const skill = path.join(directory, 'skill')
  await mkdir(skill)
  await writeFile(path.join(skill, 'SKILL.md'), `---\nname: test\n${frontmatter}\n---\nTest skill\n`)
  return { directory, skill }
}

describe.skipIf(process.platform !== 'linux')('real skill environment inspection', () => {
  it('keeps undeclared skills ready without executing any dependency probes', async () => {
    const { skill } = await fixture('')
    const check = await inspectSkillEnvironment(skill)
    expect(check.state).toBe('ready')
    expect(check.snapshot.python).toBeNull()
  })
  it('reports a missing binary, incompatible Python and wrong platform before a run', async () => {
    const { skill } = await fixture('requires:\n  bins: [missing-pandoc]\n  python: ">=99"\n  platforms: [imaginary]')
    const check = await inspectSkillEnvironment(skill)
    expect(check.state).toBe('setup_required')
    expect(check.missing.join(' ')).toMatch(/missing-pandoc/)
    expect(check.missing.join(' ')).toMatch(/>=99/)
    expect(check.missing.join(' ')).toMatch(/imaginary/)
  })
  it('verifies exact package versions only in an app-owned venv and detects removal or skill updates', async () => {
    const { directory, skill } = await fixture('requires:\n  python: ">=3.10"\n  packages:\n    pip: [pip>=1]')
    execFileSync('/usr/bin/python3', ['-I', '-m', 'venv', path.join(directory, 'venv')], { timeout: 30_000 })
    const missing = await inspectSkillEnvironment(skill)
    expect(missing.missing).toContain('pip pip>=1')
    const ready = await inspectSkillEnvironment(skill, directory)
    expect(ready.state).toBe('ready')
    expect(ready.snapshot.packages?.['pip>=1']?.path).toBe(path.join(directory, 'venv/bin/python'))
    await writeFile(
      path.join(skill, 'SKILL.md'),
      '---\nname: changed\nrequires:\n  packages:\n    pip: [pip>=999]\n---\nchanged\n'
    )
    const changed = await inspectSkillEnvironment(skill, directory)
    expect(changed.state).toBe('setup_required')
    expect(changed.fingerprint).not.toBe(ready.fingerprint)
    await rm(path.join(directory, 'venv'), { recursive: true })
    expect((await inspectSkillEnvironment(skill, directory)).state).toBe('setup_required')
  }, 40_000)
  it('detects a missing optional dependency for a declared pip extra without importing package code', async () => {
    const { directory, skill } = await fixture('requires:\n  packages:\n    pip: ["sample-extra[full]>=1"]')
    execFileSync('/usr/bin/python3', ['-I', '-m', 'venv', path.join(directory, 'venv')], { timeout: 30_000 })
    const python = path.join(directory, 'venv/bin/python')
    const sitePackages = execFileSync(python, ['-I', '-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'], {
      encoding: 'utf8'
    }).trim()
    const mainMetadata = path.join(sitePackages, 'sample_extra-1.0.dist-info')
    await mkdir(mainMetadata)
    await writeFile(
      path.join(mainMetadata, 'METADATA'),
      'Metadata-Version: 2.1\nName: sample-extra\nVersion: 1.0\nProvides-Extra: full\nRequires-Dist: sample-dependency>=1; extra == "full"\n'
    )
    expect((await inspectSkillEnvironment(skill, directory)).state).toBe('setup_required')
    const dependency = path.join(sitePackages, 'sample_dependency-1.0.dist-info')
    await mkdir(dependency)
    await writeFile(path.join(dependency, 'METADATA'), 'Metadata-Version: 2.1\nName: sample-dependency\nVersion: 1.0\n')
    expect((await inspectSkillEnvironment(skill, directory)).state).toBe('ready')
    await rm(dependency, { recursive: true })
    expect((await inspectSkillEnvironment(skill, directory)).state).toBe('setup_required')
  }, 40_000)

  it('returns unknown-field warnings without treating them as approved installer commands', async () => {
    const { skill } = await fixture('requires:\n  strange_field: true\n  packages:\n    npm: [example]')
    const check = await inspectSkillEnvironment(skill)
    expect(check.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('strange_field'), expect.stringContaining('npm')])
    )
  })
  it.each([
    '--target=/task',
    '-e .',
    'https://example.test/pkg.whl',
    'name @ https://example.test/pkg',
    '../local',
    'name;touch /tmp/x',
    'name$(id)'
  ])('rejects non-package installer input %s', (requirement) => {
    expect(SAFE_PIP_REQUIREMENT.test(requirement)).toBe(false)
    expect(() => validateSetupRequirements({ packages: { pip: [requirement] } })).toThrow(
      'names and version constraints'
    )
  })
  it.each(['pypdf==5.1.0', 'package[extra]>=1,<2', 'numpy~=2.1', 'Pillow', 'package!=1.2.*'])(
    'preserves a safe requirement as one exact argument: %s',
    (requirement) => {
      expect(validateSetupRequirements({ packages: { pip: [requirement] } })).toEqual([requirement])
    }
  )
})
