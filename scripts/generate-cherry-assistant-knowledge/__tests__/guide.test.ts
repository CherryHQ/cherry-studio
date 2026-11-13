import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..')
const AGENT_TEMPLATE_PATH = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant/agent-template.json')
const SUPPORT_AGENT_TEMPLATE_PATH = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-support/agent-template.json')
const SUPPORT_AGENT_PATH = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-support/agent.json')

describe('Cherry Assistant guide', () => {
  it('declares only skills that are bundled with Cherry Assistant', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as { skills: string[] }
    const skillsDir = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant/.claude/skills')

    for (const skill of agent.skills) {
      expect(fs.existsSync(path.join(skillsDir, skill, 'SKILL.md')), `${skill} is missing its bundled SKILL.md`).toBe(
        true
      )
    }
  })

  it('keeps the generated support agent aligned with its template', () => {
    const template = JSON.parse(fs.readFileSync(SUPPORT_AGENT_TEMPLATE_PATH, 'utf-8'))
    const generated = JSON.parse(fs.readFileSync(SUPPORT_AGENT_PATH, 'utf-8'))

    expect(generated).not.toHaveProperty('_generated_note')
    expect(generated).toEqual(Object.fromEntries(Object.entries(template).filter(([key]) => !key.startsWith('_'))))
  })
})
