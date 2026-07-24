import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..')
const TEMPLATE_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-assistant-guide/SKILL.zh-CN.template.md'
)
const AGENT_TEMPLATE_PATH = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant/agent.template.json')
const DOC_WRITER_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-doc-writer/SKILL.md'
)
const MARKETPLACE_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-skill-marketplace/SKILL.md'
)
const SKILLS_MANAGER_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/skills-manager/SKILL.md'
)
const WEB_PPT_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-web-ppt/SKILL.md'
)
const CHERRY_PPT_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-ppt/SKILL.md'
)
const SKILL_CREATOR_PATH = path.join(ROOT_DIR, 'resources/skills/skill-creator/SKILL.md')
const SUPPORTING_PROMPT_PATHS = [
  'resources/builtin-agents/cherry-assistant/SOUL.md',
  'resources/builtin-agents/cherry-assistant/USER.md',
  'resources/builtin-agents/cherry-assistant/memory/FACT.md',
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-skill-marketplace/SKILL.md',
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-web-ppt/SKILL.md'
]

describe('Cherry Assistant guide', () => {
  const guide = fs.readFileSync(TEMPLATE_PATH, 'utf-8')

  it('uses current-package lookups instead of versioned product prose', () => {
    expect(guide).toContain('mcp__assistant__product_info({ source: "manifest" })')
    for (const section of ['routes', 'commands', 'providers', 'locales', 'agents']) {
      expect(guide).toContain(`source: "manifest", section: "${section}"`)
    }
    expect(guide).toContain('section: "all"')
    expect(guide).not.toContain('source: "release_notes"')

    for (const staleSection of ['## 路由表', '## 常见问题', '## 功能速查', '## 快捷键', '## 日志路径']) {
      expect(guide).not.toContain(staleSection)
    }
  })

  it('does not hard-code application or settings routes', () => {
    expect(guide).not.toMatch(/`\/(?:app|settings)\//)
  })

  it('keeps the agent general-purpose and routes product questions through current package data', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as {
      instructions: Record<string, string>
      accessible_paths: string[]
    }
    const instructions = Object.values(agent.instructions).join('\n')

    expect(instructions).toContain('mcp__assistant__product_info')
    expect(agent.instructions['zh-CN']).toContain('不能仅因问题与 Cherry Studio 无关而拒答')
    expect(instructions).not.toMatch(/\/(?:app|settings)\//)
    expect(agent.accessible_paths).toEqual(['#{PROJECT_ROOT}'])
  })

  it('declares only skills that are bundled with Cherry Assistant', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as { skills: string[] }
    const skillsDir = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant/.claude/skills')

    for (const skill of agent.skills) {
      expect(fs.existsSync(path.join(skillsDir, skill, 'SKILL.md')), `${skill} is missing its bundled SKILL.md`).toBe(
        true
      )
    }
  })

  it('defaults the generated assistant to auto-edit mode', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as {
      configuration: { permission_mode: string }
    }

    expect(agent.configuration.permission_mode).toBe('acceptEdits')
  })

  it('keeps supporting prompts on the same dynamic product lookup path', () => {
    const supportingPrompts = SUPPORTING_PROMPT_PATHS.map((relativePath) =>
      fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf-8')
    ).join('\n')

    expect(supportingPrompts).toContain('mcp__assistant__product_info')
    expect(supportingPrompts).not.toMatch(/\/(?:app|settings)\//)
    expect(supportingPrompts).not.toContain('open.cherryin.ai')
  })

  it('routes PDF and DOCX conversion through content reconstruction without promising layout fidelity', () => {
    const docWriter = fs.readFileSync(DOC_WRITER_PATH, 'utf-8')

    expect(docWriter).toContain('PDF 转 Word')
    expect(docWriter).toContain('Word 转 PDF')
    expect(docWriter).toContain('内容重建式转换')
    expect(docWriter).not.toContain('不要声称支持 DOCX/PDF 互转')
    expect(docWriter).toContain('扫描件 OCR、高保真互转')
  })

  it('routes Cherry Studio template requests through Cherry-PPT', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as { skills: string[] }
    const webPpt = fs.readFileSync(WEB_PPT_PATH, 'utf-8')
    const cherryPpt = fs.readFileSync(CHERRY_PPT_PATH, 'utf-8')

    expect(agent.skills).toContain('cherry-ppt')
    expect(webPpt).toContain('立即调用 `cherry-ppt`')
    expect(cherryPpt).toContain('operation = cherry_ppt_to_pptx')
    expect(cherryPpt).toContain('保留 Master/Layout')
  })

  it('escalates unsupported requests through skill search and authoring instead of stopping', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as {
      instructions: Record<'en-US' | 'zh-CN', string>
    }
    const marketplace = fs.readFileSync(MARKETPLACE_PATH, 'utf-8')
    const skillsManager = fs.readFileSync(SKILLS_MANAGER_PATH, 'utf-8')
    const webPpt = fs.readFileSync(WEB_PPT_PATH, 'utf-8')
    const skillCreator = fs.readFileSync(SKILL_CREATOR_PATH, 'utf-8')

    expect(agent.instructions['en-US']).toContain('A capability gap is not a stopping condition')
    expect(agent.instructions['zh-CN']).toContain('能力缺口不是停止条件')
    expect(Object.values(agent.instructions).join('\n')).toContain('skill-creator')
    expect(marketplace).toContain('action="search"')
    expect(marketplace).toContain('调用内置 `skill-creator`')
    expect(marketplace).toContain('不要自行编写 `SKILL.md`')
    expect(skillCreator).toContain('action="init"')
    expect(skillCreator).toContain('action="register"')
    expect(marketplace).toContain('回到原始任务')
    expect(skillsManager).toContain('没有合适结果时直接创建')
    expect(webPpt).toContain('HTML → PPTX')
    expect(webPpt).toContain('不得停在 `unsupported`')
  })

  it('does not retain removed v1 branding, static product counts, or obsolete browser calls', () => {
    const supportingPrompts = SUPPORTING_PROMPT_PATHS.map((relativePath) =>
      fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf-8')
    ).join('\n')

    expect(supportingPrompts).not.toContain('CherryClaw')
    expect(supportingPrompts).not.toContain('支持的 AI Provider')
    expect(supportingPrompts).not.toContain('@cherry/browser')
    expect(supportingPrompts).not.toContain('mcp__cherry__browser')
    expect(supportingPrompts).not.toContain('mcp__assistant__browser')
    expect(supportingPrompts).not.toContain('q={query}')
  })
})
