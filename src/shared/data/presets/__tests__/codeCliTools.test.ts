import fs from 'node:fs'
import path from 'node:path'

import matter from 'gray-matter'
import { describe, expect, it } from 'vitest'

import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'
import { CodeCli } from '@shared/types/codeCli'

describe('Code CLI acquisition catalog', () => {
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
      expect(parsed.data.description, preset.id).toEqual(expect.stringMatching(/\S/))
    }
  })
})
