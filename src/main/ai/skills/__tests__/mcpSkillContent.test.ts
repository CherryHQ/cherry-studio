import { createHash } from 'node:crypto'

import { createMcpSkillsFixture } from '@test-helpers/mcpSkills'
import { describe, expect, it } from 'vitest'

import { MCP_SKILL_MAX_BYTES, McpSkillSchema } from '@shared/types/mcpSkills'

import { validateMcpSkill, verifyMcpSkillFile } from '../mcpSkillContent'

const hash = (value: Uint8Array | string) => `sha256:${createHash('sha256').update(value).digest('hex')}`

describe('MCP skill content boundary', () => {
  it.each(['../secret', '%2e%2e/secret', 'a/%2Fsecret', 'a\\secret', 'a?query', 'a#fragment', 'a//b', 'a/%00'])(
    'rejects root escape or ambiguous path %s',
    (path) => {
      const skill = createMcpSkillsFixture().manifest()
      skill.resources.push({ uri: `skill://reports/${path}`, size: 0, digest: hash('') })
      expect(() => validateMcpSkill(McpSkillSchema.parse(skill))).toThrow()
    }
  )

  it('rejects duplicate decoded paths, missing entry files, and mismatched names', () => {
    const skill = createMcpSkillsFixture().manifest()
    skill.resources.push({ ...skill.resources[0], uri: 'skill://reports/%53KILL.md' })
    expect(() => validateMcpSkill(skill)).toThrow('Duplicate')
    skill.resources = skill.resources.slice(1, 2)
    expect(() => validateMcpSkill(skill)).toThrow('omits')
    skill.frontmatter.name = 'other'
    expect(() => validateMcpSkill(skill)).toThrow('name')
  })

  it('accepts the 512-file and 16-MiB boundaries and rejects one extra file or byte', () => {
    const fixture = createMcpSkillsFixture()
    const skill = fixture.manifest()
    skill.resources = [skill.resources[0]]
    for (let i = 1; i < 512; i++) skill.resources.push({ uri: `skill://reports/${i}`, size: 0, digest: hash('') })
    const bytes = Buffer.alloc(MCP_SKILL_MAX_BYTES - skill.resources[0].size)
    skill.resources[1] = { ...skill.resources[1], size: bytes.length, digest: hash(bytes) }
    expect(() => validateMcpSkill(McpSkillSchema.parse(skill))).not.toThrow()
    expect(() => verifyMcpSkillFile(skill, skill.resources[1].uri, bytes)).not.toThrow()
    skill.resources[2].size = 1
    expect(() => validateMcpSkill(skill)).toThrow('16 MiB')
    skill.resources.push({ uri: 'skill://reports/extra', size: 0, digest: hash('') })
    expect(McpSkillSchema.safeParse(skill).success).toBe(false)
  })

  it('checks all frontmatter fields, byte length, and content digest before accepting instructions', () => {
    const fixture = createMcpSkillsFixture()
    const skill = fixture.manifest()
    const text = fixture.files.get(skill.uri)!
    const bytes = Buffer.from(text)
    expect(() => verifyMcpSkillFile(skill, skill.uri, bytes)).not.toThrow()
    expect(() => verifyMcpSkillFile(skill, skill.uri, bytes.subarray(1))).toThrow('verification')
    expect(() => verifyMcpSkillFile(skill, skill.uri, Buffer.from(text.replace('report', 'REPORT')))).toThrow(
      'verification'
    )
    const entry = McpSkillSchema.parse({ ...skill, frontmatter: { ...skill.frontmatter, 'allowed-tools': 'Bash' } })
    expect(() => verifyMcpSkillFile(entry, skill.uri, bytes)).toThrow('frontmatter')
  })
})
