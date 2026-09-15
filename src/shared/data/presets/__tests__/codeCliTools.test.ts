import fs from 'node:fs'
import path from 'node:path'

import matter from 'gray-matter'
import { describe, expect, it } from 'vitest'

import {
  CODE_CLI_TOOL_PRESET_BY_EXECUTABLE,
  CODE_CLI_TOOL_PRESET_MAP,
  CODE_CLI_TOOL_PRESETS
} from '@shared/data/presets/codeCliTools'
import { CodeCli } from '@shared/types/codeCli'

const EXPECTED_ACQUISITION_FACTS = [
  ['claude-code', 'claude', '@anthropic-ai/claude-code', 'registry', 'claude'],
  ['openai-codex', 'codex', '@openai/codex', 'registry', 'codex'],
  ['opencode', 'opencode', 'opencode-ai', 'registry', 'opencode'],
  ['antigravity-cli', 'agy', 'google-antigravity/antigravity-cli', 'aqua', 'aqua:google-antigravity/antigravity-cli'],
  ['openclaw', 'openclaw', 'openclaw', 'npm', 'npm:openclaw'],
  ['deepseek-harness', 'dsh', '@deepseek-ai/dsh', 'npm', 'npm:@deepseek-ai/dsh'],
  ['gemini-cli', 'gemini', '@google/gemini-cli', 'npm', 'npm:@google/gemini-cli'],
  ['qwen-code', 'qwen', '@qwen-code/qwen-code', 'npm', 'npm:@qwen-code/qwen-code'],
  ['kimi-code', 'kimi', '@moonshot-ai/kimi-code', 'npm', 'npm:@moonshot-ai/kimi-code'],
  ['qoder-cli', 'qoderclicn', '@qodercn-ai/qoderclicn', 'npm', 'npm:@qodercn-ai/qoderclicn'],
  ['github-copilot-cli', 'copilot', '@github/copilot', 'npm', 'npm:@github/copilot'],
  ['pi', 'pi', '@earendil-works/pi-coding-agent', 'npm', 'npm:@earendil-works/pi-coding-agent'],
  ['hermes', 'hermes', 'hermes-agent', 'pipx', 'pipx:hermes-agent[extras=web]']
]

const EXPECTED_SKILL_COMMANDS: Record<CodeCli, string> = {
  [CodeCli.CLAUDE_CODE]: 'claude -p "<prompt>" --output-format json',
  [CodeCli.OPENAI_CODEX]: 'codex exec "<prompt>" --json',
  [CodeCli.OPEN_CODE]: 'opencode run "<prompt>" --format json',
  [CodeCli.ANTIGRAVITY_CLI]: 'agy -p "<prompt>" --output-format json',
  [CodeCli.OPENCLAW]: 'openclaw agent --local --agent main --message "<prompt>" --json --timeout 600',
  [CodeCli.DEEPSEEK_HARNESS]: 'dsh --profile headless "<prompt>"',
  [CodeCli.GEMINI_CLI]: 'gemini -p "<prompt>" --output-format json',
  [CodeCli.QWEN_CODE]: 'qwen -p "<prompt>" --output-format json',
  [CodeCli.KIMI_CODE]: 'kimi -p "<prompt>" --output-format stream-json',
  [CodeCli.QODER_CLI]: 'qoderclicn -p "<prompt>" -o json --no-session-persistence',
  [CodeCli.GITHUB_COPILOT_CLI]: 'copilot -p "<prompt>" -s --output-format json --no-ask-user',
  [CodeCli.PI]: 'pi --mode json --no-session "<prompt>"',
  [CodeCli.HERMES]: 'hermes -z "<prompt>"'
}

const EXPECTED_SKILL_CAVEATS: Partial<Record<CodeCli, string[]>> = {
  [CodeCli.ANTIGRAVITY_CLI]: ['auto-approved by default', 'disposable or read-only copy'],
  [CodeCli.OPENCLAW]: ['exits zero', 'payload'],
  [CodeCli.DEEPSEEK_HARNESS]: ['persistent session', 'write to the workspace'],
  [CodeCli.KIMI_CODE]: ['automatically approves', 'read-only copy', 'KIMI_CODE_HOME', 'sandbox_permissions'],
  [CodeCli.QODER_CLI]: ['qoderclicn', 'is_error'],
  [CodeCli.PI]: ['no tool-approval prompt', '--tools read,grep,find,ls'],
  [CodeCli.HERMES]: ['YOLO', 'exit two']
}

describe('Code CLI acquisition catalog', () => {
  it('preserves every pre-migration acquisition fact', () => {
    expect(
      CODE_CLI_TOOL_PRESETS.map(({ id, executable, packageName, install, miseTool }) => [
        id,
        executable,
        packageName,
        install,
        miseTool
      ])
    ).toEqual(EXPECTED_ACQUISITION_FACTS)
  })

  it('covers every CodeCli id exactly once', () => {
    expect(new Set(CODE_CLI_TOOL_PRESETS.map((preset) => preset.id))).toEqual(new Set(Object.values(CodeCli)))
  })

  it('assigns every CLI a unique bundled skill folder', () => {
    const folderNames = CODE_CLI_TOOL_PRESETS.map((preset) => preset.skillFolderName)
    expect(new Set(folderNames).size).toBe(CODE_CLI_TOOL_PRESETS.length)
    expect(folderNames.every((folderName) => /^code-mate-[a-z0-9-]+$/.test(folderName))).toBe(true)
    expect(new Set(CODE_CLI_TOOL_PRESETS.map((preset) => preset.skillNamespace)).size).toBe(
      CODE_CLI_TOOL_PRESETS.length
    )
  })

  it('keeps the catalog and lookup map immutable', () => {
    expect(Object.isFrozen(CODE_CLI_TOOL_PRESETS)).toBe(true)
    expect(CODE_CLI_TOOL_PRESETS.every((preset) => Object.isFrozen(preset))).toBe(true)
    expect(Object.isFrozen(CODE_CLI_TOOL_PRESET_MAP)).toBe(true)
    expect(Object.isFrozen(CODE_CLI_TOOL_PRESET_BY_EXECUTABLE)).toBe(true)
  })

  it.each(CODE_CLI_TOOL_PRESETS)('$id: indexes the canonical preset', (preset) => {
    expect(CODE_CLI_TOOL_PRESET_MAP[preset.id]).toBe(preset)
    expect(CODE_CLI_TOOL_PRESET_BY_EXECUTABLE[preset.executable]).toBe(preset)
  })

  it('bundles exactly one valid skill for every CLI preset', () => {
    const skillsRoot = path.resolve(process.cwd(), 'resources/code-cli-skills')
    const bundledFolders = fs
      .readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(bundledFolders).toEqual(CODE_CLI_TOOL_PRESETS.map((preset) => preset.skillFolderName).sort())

    for (const preset of CODE_CLI_TOOL_PRESETS) {
      const skillPath = path.join(skillsRoot, preset.skillFolderName, 'SKILL.md')
      const source = fs.readFileSync(skillPath, 'utf8')
      const parsed = matter(source)

      expect(parsed.data.name, preset.id).toBe(preset.skillFolderName)
      expect(parsed.data.description, preset.id).toMatch(/\. Use when /)
      expect(source.split(/\r?\n/).length, preset.id).toBeLessThan(100)
      expect(source, preset.id).toContain(`command -v ${preset.executable}`)
      expect(source, preset.id).toContain(EXPECTED_SKILL_COMMANDS[preset.id])
      expect(source, preset.id).toContain('Code Mate')
      expect(source, preset.id).toContain('Never request, read, print, or copy credentials.')
      expect(source, preset.id).toContain('timeout')
      expect(source, preset.id).toMatch(/explicitly request(?:s|ed)? workspace changes/)
      expect(source, preset.id).toContain('Example:')

      for (const caveat of EXPECTED_SKILL_CAVEATS[preset.id] ?? []) {
        expect(source, preset.id).toContain(caveat)
      }
    }
  })
})
