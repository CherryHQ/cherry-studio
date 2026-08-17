import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..')
const TEMPLATE_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-assistant-guide/skill-zh-cn-template.md'
)
const AGENT_TEMPLATE_PATH = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant/agent-template.json')
const SUPPORT_AGENT_TEMPLATE_PATH = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-support/agent-template.json')
const SUPPORT_AGENT_PATH = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-support/agent.json')
const SOUL_PATH = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant/SOUL.md')
const USER_PATH = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant/USER.md')
const MARKETPLACE_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-skill-marketplace/SKILL.md'
)
const FEEDBACK_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-studio-feedback/SKILL.md'
)
const ISSUE_REPORTER_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/issue-reporter/SKILL.md'
)
const SKILLS_MANAGER_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/skills-manager/SKILL.md'
)
const SUPPORTING_PROMPT_PATHS = [
  'resources/builtin-agents/cherry-assistant/SOUL.md',
  'resources/builtin-agents/cherry-assistant/USER.md',
  'resources/builtin-agents/cherry-assistant/memory/FACT.md'
]

describe('Cherry Assistant guide', () => {
  const guide = fs.readFileSync(TEMPLATE_PATH, 'utf-8')

  it('uses current-package lookups instead of versioned product prose', () => {
    expect(guide).toContain('报告运行错误、连接失败、配置异常并需要诊断时触发')
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

    expect(agent.instructions['en-US']).toContain('built-in general-purpose Agent and onboarding guide')
    expect(agent.instructions['en-US']).toContain('complete any request using the available tools')
    expect(agent.instructions['en-US']).toContain(
      'taking particular ownership of helping them succeed with Cherry Studio'
    )
    expect(agent.instructions['en-US']).toContain(
      'Use `cherry-studio-feedback` unless the user explicitly asks for a GitHub Issue'
    )
    expect(agent.instructions['zh-CN']).toContain('内置通用 Agent 和上手引导')
    expect(agent.instructions['zh-CN']).toContain('帮助用户完成任何请求')
    expect(agent.instructions['zh-CN']).toContain('帮助将其整理成清晰、可执行的反馈')
    expect(guide).toContain('mcp__assistant__product_info')
    expect(guide).toContain('必须在同一轮调用 `mcp__assistant__navigate`')
    expect(guide).toContain('不得声称已经生成入口或已经打开页面')
    expect(instructions).not.toMatch(/\/(?:app|settings)\//)
    expect(agent.accessible_paths).toEqual(['#{PROJECT_ROOT}'])
  })

  it('keeps the onboarding persona concise instead of imposing a detailed behavior contract', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as {
      instructions: Record<'en-US' | 'zh-CN', string>
    }
    const soul = fs.readFileSync(SOUL_PATH, 'utf-8')

    expect(agent.instructions['en-US']).toContain('getting started with Cherry Studio')
    expect(agent.instructions['zh-CN']).toContain('帮助用户开始使用 Cherry Studio')
    expect(soul).toContain('Warm, patient, and practical')
    expect(soul).toContain("Mirror the user's terminology and level of formality")
    expect(soul).not.toContain("Match the user's language")
    expect(soul).not.toContain('Cherry Studio')
    expect(soul).not.toContain('cherry-studio-feedback')
    expect(soul).not.toContain('Working principles')
    expect(soul).not.toContain('Hard safety constraints')
  })

  it('identifies the preset without restricting the underlying runtime', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as {
      instructions: Record<'en-US' | 'zh-CN', string>
    }
    const soul = fs.readFileSync(SOUL_PATH, 'utf-8')

    expect(agent.instructions['en-US']).toContain('introduce yourself as Cherry Assistant')
    expect(agent.instructions['zh-CN']).toContain('自我介绍为 Cherry Assistant')
    expect(agent.instructions['en-US']).toContain('serve as Cherry Assistant')
    expect(agent.instructions['en-US']).not.toContain("You are Cherry Studio's built-in onboarding Agent")
    expect(soul).not.toContain('Cherry Assistant')
    expect(soul).not.toContain('general-purpose Agent')
    expect(soul).not.toContain('same tools and capabilities')
    expect(soul).not.toContain('Claude Code')
  })

  it('keeps the user template neutral without duplicating a system-prompt contract', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as {
      instructions: Record<'en-US' | 'zh-CN', string>
    }
    const user = fs.readFileSync(USER_PATH, 'utf-8')

    expect(Object.values(agent.instructions).join('\n')).not.toContain('Speaker reference and data ownership')
    expect(user).toContain('Not provided')
    expect(user).toContain('not verified personal facts')
  })

  it('keeps safety enforcement out of the onboarding prompt', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as {
      instructions: Record<'en-US' | 'zh-CN', string>
    }
    const soul = fs.readFileSync(SOUL_PATH, 'utf-8')

    const prompt = `${Object.values(agent.instructions).join('\n')}\n${soul}`
    expect(prompt).not.toContain('Security')
    expect(prompt).not.toContain('安全边界')
    expect(prompt).not.toContain('mcp__assistant-files__move_to_trash')
  })

  it('searches skills before declaring a capability unsupported and delegates creation to skill-creator', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as {
      instructions: Record<'en-US' | 'zh-CN', string>
    }
    const skillsManager = fs.readFileSync(SKILLS_MANAGER_PATH, 'utf-8')
    const marketplace = fs.readFileSync(MARKETPLACE_PATH, 'utf-8')

    expect(Object.values(agent.instructions).join('\n')).not.toContain('find-skills')
    expect(skillsManager).toContain('`find-skills` 可用时先调用它')
    expect(skillsManager).toContain('`skill-creator` 可用时必须调用它')
    expect(skillsManager).toContain('不要绕过它直接手写 `SKILL.md`')
    expect(marketplace).toContain('`mcp__skills__search_skills`')
    expect(marketplace).toContain('`mcp__skills__install_skill`')
    expect(marketplace).toContain('调用内置 `skill-creator`')
    expect(marketplace).toContain('不要自行编写 `SKILL.md`')
    expect(marketplace).toContain('回到原始任务')
  })

  it('bundles a consented and redacted Cherry Studio feedback workflow', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as {
      instructions: Record<'en-US' | 'zh-CN', string>
      skills: string[]
    }
    const feedback = fs.readFileSync(FEEDBACK_PATH, 'utf-8')
    const issueReporter = fs.readFileSync(ISSUE_REPORTER_PATH, 'utf-8')

    expect(agent.skills).toContain('cherry-studio-feedback')
    expect(agent.instructions['en-US']).toContain('Use `cherry-studio-feedback` unless the user explicitly asks')
    expect(agent.instructions['zh-CN']).toContain('明确要求创建 GitHub Issue')
    expect(feedback).toContain('mcp__assistant__diagnose({ action: "info" })')
    expect(feedback).toContain('mcp__assistant__diagnose({ action: "errors", lines: 100 })')
    expect(feedback).toContain('mcp__assistant-files__save_attachment')
    expect(feedback).toContain('外部提交前展示最终字段、附件文件名和接收方')
    expect(feedback).toContain('lark-cli base +form-detail')
    expect(feedback).toContain('auth status --json --verify')
    expect(feedback).toContain('--as user --json ... --yes')
    expect(feedback).not.toContain('不存在的 `--yes`')
    expect(feedback).toContain('返回 `ok == true`')
    expect(feedback).toContain('不要安装、升级或重新配置 `lark-cli`')
    expect(feedback).toContain('匿名反馈包上传')
    expect(feedback).toContain('未明确提及 GitHub 时，不要调用 `gh`')
    expect(feedback).toContain('不盲目解压整个压缩包')
    expect(feedback).toContain('“上传错误信息”按钮属于客户端/服务端功能')
    expect(feedback).not.toContain('cherrystudio.sqlite')
    expect(feedback).not.toContain('~/Documents/Cherry')
    expect(feedback).not.toContain('UqjTbBFGWapnOrsJaDgcuyEbnUg')
    expect(issueReporter).toContain('只有用户明确要求提交到 GitHub')
    expect(issueReporter).toContain('不得运行 `gh auth status`')
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
    expect(supportingPrompts).not.toContain('live official release notes')
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

  it('generates a dedicated Cherry Support identity with only the four support skills', () => {
    const template = JSON.parse(fs.readFileSync(SUPPORT_AGENT_TEMPLATE_PATH, 'utf-8'))
    const generated = JSON.parse(fs.readFileSync(SUPPORT_AGENT_PATH, 'utf-8'))

    expect(generated).toEqual(
      expect.objectContaining({
        name: { 'en-US': 'Cherry Support', 'zh-CN': '产品反馈' },
        configuration: expect.objectContaining({
          avatar: '🧰',
          permission_mode: 'acceptEdits',
          bootstrap_completed: true,
          builtin_role: 'support'
        }),
        skills: ['cherry-assistant-guide', 'faq-collector', 'cherry-studio-feedback', 'issue-reporter']
      })
    )
    expect(generated.instructions['en-US']).toContain('Your scope has four parts')
    expect(generated.instructions['en-US']).toContain('Never introduce yourself as a general-purpose AI')
    expect(generated.instructions['en-US']).toContain('direct the user to Cherry Assistant')
    expect(generated.instructions['zh-CN']).toContain('答疑解惑')
    expect(generated.instructions['zh-CN']).toContain('使用帮助')
    expect(generated.instructions['zh-CN']).toContain('问题排查')
    expect(generated.instructions['zh-CN']).toContain('反馈整理与提交')
    expect(generated.instructions['zh-CN']).toContain('绝不要把自己介绍成通用 AI、编程 Agent 或任务代理')
    expect(generated.instructions['zh-CN']).toContain('自我介绍为产品反馈')
    expect(generated).not.toHaveProperty('_generated_note')
    expect(generated).toEqual(Object.fromEntries(Object.entries(template).filter(([key]) => !key.startsWith('_'))))
  })
})
