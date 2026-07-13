import { CLI_BINARY_NAMES, CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'
import { CodeCli } from '@shared/types/codeCli'
import { describe, expect, it } from 'vitest'

const EXPECTED_ACQUISITION_FACTS = [
  ['claude-code', 'claude', '@anthropic-ai/claude-code', 'registry', 'claude'],
  ['openai-codex', 'codex', '@openai/codex', 'registry', 'codex'],
  ['opencode', 'opencode', 'opencode-ai', 'registry', 'opencode'],
  ['openclaw', 'openclaw', 'openclaw', 'npm', 'npm:openclaw'],
  ['gemini-cli', 'gemini', '@google/gemini-cli', 'npm', 'npm:@google/gemini-cli'],
  ['qwen-code', 'qwen', '@qwen-code/qwen-code', 'npm', 'npm:@qwen-code/qwen-code'],
  ['kimi-code', 'kimi', '@moonshot-ai/kimi-code', 'npm', 'npm:@moonshot-ai/kimi-code'],
  ['qoder-cli', 'qoderclicn', '@qodercn-ai/qoderclicn', 'npm', 'npm:@qodercn-ai/qoderclicn'],
  ['github-copilot-cli', 'copilot', '@github/copilot', 'npm', 'npm:@github/copilot']
]

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

  it('keeps the catalog and derived binary-name map immutable', () => {
    expect(Object.isFrozen(CODE_CLI_TOOL_PRESETS)).toBe(true)
    expect(CODE_CLI_TOOL_PRESETS.every((preset) => Object.isFrozen(preset))).toBe(true)
    expect(Object.isFrozen(CLI_BINARY_NAMES)).toBe(true)
  })

  it.each(CODE_CLI_TOOL_PRESETS)('$id: derives the binary name from the executable', (preset) => {
    expect(CLI_BINARY_NAMES[preset.id]).toBe(preset.executable)
  })
})
