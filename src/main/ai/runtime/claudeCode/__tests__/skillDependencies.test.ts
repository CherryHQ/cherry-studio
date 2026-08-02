import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findExecutableInEnv: vi.fn<(name: string) => Promise<string | null>>(),
  getByFolderName: vi.fn(() => null),
  listAll: vi.fn<() => Array<{ folderName: string; name: string }>>(),
  getInstalledSkillDirectory: vi.fn(() => ''),
  skillPluginDirectory: { value: '/nonexistent-claude-root' }
}))

vi.mock('@main/utils/commandResolver', () => ({ findExecutableInEnv: mocks.findExecutableInEnv }))
vi.mock('@data/services/AgentGlobalSkillService', () => ({
  agentGlobalSkillService: { getByFolderName: mocks.getByFolderName, listAll: mocks.listAll }
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

  /** A library skill whose directory name and SKILL.md `name` disagree, as a bundle's often do. */
  async function writeLibrarySkill(folderName: string, declaredName: string, frontmatter: string) {
    const directory = path.join(await createTempDir('skill-deps-library-'), folderName)
    await fs.promises.mkdir(directory, { recursive: true })
    await fs.promises.writeFile(
      path.join(directory, 'SKILL.md'),
      `---\nname: ${declaredName}\ndescription: test skill\n${frontmatter}---\n\nBody\n`
    )
    mocks.getInstalledSkillDirectory.mockReturnValue(directory)
    return directory
  }

  beforeEach(() => {
    mocks.findExecutableInEnv.mockResolvedValue('/usr/bin/anything')
    mocks.getByFolderName.mockReturnValue(null)
    mocks.listAll.mockReturnValue([])
    mocks.skillPluginDirectory.value = '/nonexistent-claude-root'
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })))
  })

  // The index only holds the plugins settingsBuilder passes; the enabled setting sources let the SDK
  // load others, so an unindexed plugin is not evidence that its subagent is missing.
  it('warns instead of denying when the subagent plugin is not in the index', async () => {
    const workdir = await writeWorkspaceSkill(
      'parallel-web-search',
      'context: fork\nagent: parallel:parallel-subagent\n'
    )

    const result = await checkSkillRuntimeDependencies('parallel-web-search', workdir, new Map())

    expect(result.deny).toBeUndefined()
    expect(result.warning).toContain('"parallel:parallel-subagent"')
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
    const plugin = await writePlugin('parallel', ['some-other-agent'])
    mocks.findExecutableInEnv.mockResolvedValue(null)

    const result = await checkSkillRuntimeDependencies(
      'parallel-web-search',
      workdir,
      await buildPluginDirectoryIndex([plugin])
    )

    expect(result.deny).toContain('its forked subagent "parallel:parallel-subagent" is not installed')
    expect(result.deny).toContain('the executable "parallel-cli"')
  })

  // The guard rule and the advisory hook both ask about the same tool call.
  it('probes PATH once when both PreToolUse planes ask about the same call', async () => {
    const workdir = await writeWorkspaceSkill('local-skill', 'allowed-tools: Bash(jq:*)\n')

    await Promise.all([
      checkSkillRuntimeDependencies('local-skill', workdir, new Map()),
      checkSkillRuntimeDependencies('local-skill', workdir, new Map())
    ])

    expect(mocks.findExecutableInEnv).toHaveBeenCalledExactlyOnceWith('jq')
  })

  // The installer names the folder after the bundle directory, so a name-addressed call would
  // otherwise skip the check for every bundle whose directory does not match its `name`.
  it('checks a library skill addressed by its SKILL.md name rather than its folder', async () => {
    await writeLibrarySkill('vendor-bundle-dir', 'parallel-web-search', 'context: fork\nagent: parallel:missing\n')
    mocks.listAll.mockReturnValue([{ folderName: 'vendor-bundle-dir', name: 'parallel-web-search' }])
    const plugin = await writePlugin('parallel', ['some-other-agent'])

    const result = await checkSkillRuntimeDependencies(
      'parallel-web-search',
      await createTempDir('skill-deps-workspace-'),
      await buildPluginDirectoryIndex([plugin])
    )

    expect(result.deny).toContain('its forked subagent "parallel:missing" is not installed')
  })

  it('refuses to guess when the name matches more than one library skill', async () => {
    mocks.listAll.mockReturnValue([
      { folderName: 'first-copy', name: 'parallel-web-search' },
      { folderName: 'second-copy', name: 'parallel-web-search' }
    ])

    const result = await checkSkillRuntimeDependencies(
      'parallel-web-search',
      await createTempDir('skill-deps-workspace-'),
      new Map()
    )

    expect(result).toEqual({})
    expect(mocks.getInstalledSkillDirectory).not.toHaveBeenCalled()
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
