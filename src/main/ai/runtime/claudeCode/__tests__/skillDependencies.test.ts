import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findExecutableInEnv: vi.fn<(name: string) => Promise<string | null>>(),
  getByFolderName: vi.fn(() => null as unknown),
  getInstalledSkillDirectory: vi.fn(() => ''),
  skillPluginDirectory: { value: '/nonexistent-claude-root' }
}))

vi.mock('@main/utils/commandResolver', () => ({ findExecutableInEnv: mocks.findExecutableInEnv }))
vi.mock('@data/services/AgentGlobalSkillService', () => ({
  agentGlobalSkillService: { getByFolderName: mocks.getByFolderName }
}))
vi.mock('@main/ai/skills/SkillService', () => ({
  skillService: {
    getInstalledSkillDirectory: mocks.getInstalledSkillDirectory,
    getSkillPluginDirectory: () => mocks.skillPluginDirectory.value
  }
}))

import { buildPluginDirectoryIndex, checkSkillRuntimeDependencies } from '../skillDependencies'

describe('checkSkillRuntimeDependencies', () => {
  const tempDirs: string[] = []

  async function createTempDir(prefix: string) {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  /** Write a real SKILL.md so the frontmatter parser, not a stub, decides what was declared. */
  async function writeWorkspaceSkill(name: string, frontmatter: string) {
    const workdir = await createTempDir('skill-deps-workspace-')
    const directory = path.join(workdir, '.claude', 'skills', name)
    await fs.promises.mkdir(directory, { recursive: true })
    await fs.promises.writeFile(
      path.join(directory, 'SKILL.md'),
      `---\nname: ${name}\ndescription: test skill\n${frontmatter}---\n\nBody\n`
    )
    return workdir
  }

  async function writePlugin(name: string, agentNames: string[]) {
    const directory = await createTempDir(`plugin-${name}-`)
    await fs.promises.mkdir(path.join(directory, '.claude-plugin'), { recursive: true })
    await fs.promises.writeFile(path.join(directory, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }))
    if (agentNames.length > 0) {
      await fs.promises.mkdir(path.join(directory, 'agents'), { recursive: true })
      for (const agentName of agentNames) {
        await fs.promises.writeFile(path.join(directory, 'agents', `${agentName}.md`), '# Agent')
      }
    }
    return directory
  }

  beforeEach(() => {
    mocks.findExecutableInEnv.mockResolvedValue('/usr/bin/anything')
    mocks.getByFolderName.mockReturnValue(null)
    mocks.skillPluginDirectory.value = '/nonexistent-claude-root'
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })))
  })

  it('denies a forked skill whose subagent plugin is not loaded', async () => {
    const workdir = await writeWorkspaceSkill(
      'parallel-web-search',
      'context: fork\nagent: parallel:parallel-subagent\n'
    )

    const result = await checkSkillRuntimeDependencies('parallel-web-search', workdir, new Map())

    expect(result.deny).toBe(
      'Skill "parallel-web-search" cannot run: its forked subagent "parallel:parallel-subagent" is not installed.'
    )
  })

  it('denies a forked skill whose plugin is loaded but defines no such subagent', async () => {
    const workdir = await writeWorkspaceSkill(
      'parallel-web-search',
      'context: fork\nagent: parallel:parallel-subagent\n'
    )
    const plugin = await writePlugin('parallel', ['some-other-agent'])

    const result = await checkSkillRuntimeDependencies(
      'parallel-web-search',
      workdir,
      await buildPluginDirectoryIndex([plugin])
    )

    expect(result.deny).toContain('its forked subagent "parallel:parallel-subagent" is not installed')
  })

  it('allows a forked skill once its plugin subagent exists', async () => {
    const workdir = await writeWorkspaceSkill(
      'parallel-web-search',
      'context: fork\nagent: parallel:parallel-subagent\n'
    )
    const plugin = await writePlugin('parallel', ['parallel-subagent'])

    const result = await checkSkillRuntimeDependencies(
      'parallel-web-search',
      workdir,
      await buildPluginDirectoryIndex([plugin])
    )

    expect(result).toEqual({})
  })

  it('warns instead of denying when a bare subagent name does not resolve', async () => {
    const workdir = await writeWorkspaceSkill('reviewer-skill', 'context: fork\nagent: my-custom-reviewer\n')

    const result = await checkSkillRuntimeDependencies('reviewer-skill', workdir, new Map())

    expect(result.deny).toBeUndefined()
    expect(result.warning).toContain('"my-custom-reviewer"')
  })

  it('treats SDK builtin subagents as available', async () => {
    const workdir = await writeWorkspaceSkill('explore-skill', 'context: fork\nagent: general-purpose\n')

    expect(await checkSkillRuntimeDependencies('explore-skill', workdir, new Map())).toEqual({})
  })

  it('ignores a declared agent when the skill does not fork', async () => {
    const workdir = await writeWorkspaceSkill('inline-skill', 'agent: parallel:parallel-subagent\n')

    expect(await checkSkillRuntimeDependencies('inline-skill', workdir, new Map())).toEqual({})
  })

  // allowed-tools entries are often interchangeable alternatives: shadcn declares three CLIs for the
  // same operation, so an npm-only machine must still be able to run it.
  it('never denies over allowed-tools executables and names the ones that did not resolve', async () => {
    const workdir = await writeWorkspaceSkill(
      'shadcn',
      'allowed-tools: Bash(npx shadcn@latest *), Bash(pnpm dlx shadcn@latest *), Bash(bunx --bun shadcn@latest *)\n'
    )
    mocks.findExecutableInEnv.mockImplementation(async (name) => (name === 'npx' ? '/usr/bin/npx' : null))

    const result = await checkSkillRuntimeDependencies('shadcn', workdir, new Map())

    expect(result.deny).toBeUndefined()
    expect(result.warning).toContain('the executables "pnpm", "bunx"')
    expect(result.warning).not.toContain('"npx"')
  })

  it('skips shell builtins and stays silent when every declared executable resolves', async () => {
    const workdir = await writeWorkspaceSkill('local-skill', 'allowed-tools: Bash(cd:*), Bash(echo:*), Bash(jq:*)\n')

    expect(await checkSkillRuntimeDependencies('local-skill', workdir, new Map())).toEqual({})
    expect(mocks.findExecutableInEnv).toHaveBeenCalledExactlyOnceWith('jq')
  })

  it('reports both gaps when a denied skill also declares an unresolved executable', async () => {
    const workdir = await writeWorkspaceSkill(
      'parallel-web-search',
      'context: fork\nagent: parallel:parallel-subagent\nallowed-tools: Bash(parallel-cli:*)\n'
    )
    mocks.findExecutableInEnv.mockResolvedValue(null)

    const result = await checkSkillRuntimeDependencies('parallel-web-search', workdir, new Map())

    expect(result.deny).toContain('its forked subagent "parallel:parallel-subagent" is not installed')
    expect(result.deny).toContain('the executable "parallel-cli"')
  })

  it('stays silent for a skill it cannot locate', async () => {
    const workdir = await createTempDir('skill-deps-empty-')

    expect(await checkSkillRuntimeDependencies('not-installed', workdir, new Map())).toEqual({})
  })

  it('resolves a plugin-qualified skill through its plugin directory', async () => {
    const plugin = await writePlugin('parallel', [])
    const skillDirectory = path.join(plugin, 'skills', 'web-search')
    await fs.promises.mkdir(skillDirectory, { recursive: true })
    await fs.promises.writeFile(
      path.join(skillDirectory, 'SKILL.md'),
      '---\nname: web-search\ndescription: test\ncontext: fork\nagent: parallel:missing-agent\n---\n\nBody\n'
    )
    const workdir = await createTempDir('skill-deps-workspace-')

    const result = await checkSkillRuntimeDependencies(
      'parallel:web-search',
      workdir,
      await buildPluginDirectoryIndex([plugin])
    )

    expect(result.deny).toContain('its forked subagent "parallel:missing-agent" is not installed')
  })

  it('resolves a bare subagent from the workspace and the Cherry plugin root', async () => {
    const workdir = await writeWorkspaceSkill('reviewer-skill', 'context: fork\nagent: my-custom-reviewer\n')
    await fs.promises.mkdir(path.join(workdir, '.claude', 'agents'), { recursive: true })
    await fs.promises.writeFile(path.join(workdir, '.claude', 'agents', 'my-custom-reviewer.md'), '# Agent')

    expect(await checkSkillRuntimeDependencies('reviewer-skill', workdir, new Map())).toEqual({})

    await fs.promises.rm(path.join(workdir, '.claude', 'agents'), { recursive: true })
    const claudeRoot = await createTempDir('claude-root-')
    await fs.promises.mkdir(path.join(claudeRoot, 'agents'), { recursive: true })
    await fs.promises.writeFile(path.join(claudeRoot, 'agents', 'my-custom-reviewer.md'), '# Agent')
    mocks.skillPluginDirectory.value = claudeRoot

    expect(await checkSkillRuntimeDependencies('reviewer-skill', workdir, new Map())).toEqual({})
  })
})

describe('buildPluginDirectoryIndex', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })))
  })

  it('skips unreadable and malformed manifests instead of failing the session', async () => {
    const good = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'plugin-good-'))
    const broken = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'plugin-broken-'))
    tempDirs.push(good, broken)
    await fs.promises.mkdir(path.join(good, '.claude-plugin'), { recursive: true })
    await fs.promises.mkdir(path.join(broken, '.claude-plugin'), { recursive: true })
    await fs.promises.writeFile(path.join(good, '.claude-plugin', 'plugin.json'), '{"name":"good"}')
    await fs.promises.writeFile(path.join(broken, '.claude-plugin', 'plugin.json'), '{ not json')

    const index = await buildPluginDirectoryIndex([good, broken, '/nonexistent-plugin'])

    expect(index).toEqual(new Map([['good', good]]))
  })
})
