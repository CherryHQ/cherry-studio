import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..')
const TEMPLATE_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-assistant-guide/SKILL.zh-CN.template.md'
)
const AGENT_TEMPLATE_PATH = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant/agent.template.json')
const SOUL_PATH = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant/SOUL.md')
const USER_PATH = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant/USER.md')
const DOC_WRITER_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-doc-writer/SKILL.md'
)
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
const WEB_PPT_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-web-ppt/SKILL.md'
)
const CHERRY_PPT_PATH = path.join(
  ROOT_DIR,
  'resources/builtin-agents/cherry-assistant/.claude/skills/cherry-ppt/SKILL.md'
)
const SUPPORTING_PROMPT_PATHS = [
  'resources/builtin-agents/cherry-assistant/SOUL.md',
  'resources/builtin-agents/cherry-assistant/USER.md',
  'resources/builtin-agents/cherry-assistant/memory/FACT.md'
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

  it('keeps the assistant lively and patient without forcing humor', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as {
      instructions: Record<'en-US' | 'zh-CN', string>
    }
    const soul = fs.readFileSync(SOUL_PATH, 'utf-8')

    expect(agent.instructions['en-US']).toContain('warm, lively, and natural')
    expect(agent.instructions['en-US']).toContain('rephrase instead of repeating')
    expect(agent.instructions['en-US']).toContain('never force jokes')
    expect(agent.instructions['zh-CN']).toContain('温暖、活泼、自然')
    expect(agent.instructions['zh-CN']).toContain('换一种说法解释')
    expect(agent.instructions['zh-CN']).toContain('不强行讲笑话')
    expect(soul).toContain('Sound lively and natural')
    expect(soul).toContain('rephrase instead of repeating yourself')
  })

  it('keeps the Cherry Assistant identity distinct from its underlying runtime', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as {
      instructions: Record<'en-US' | 'zh-CN', string>
    }
    const soul = fs.readFileSync(SOUL_PATH, 'utf-8')

    expect(agent.instructions['en-US']).toContain('Never identify yourself as Claude Code')
    expect(agent.instructions['zh-CN']).toContain('不得自称 Claude Code')
    expect(soul).toContain('Never introduce yourself as Claude Code')
  })

  it('grounds conversational references and tool results to the correct data owner', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as {
      instructions: Record<'en-US' | 'zh-CN', string>
    }
    const soul = fs.readFileSync(SOUL_PATH, 'utf-8')
    const user = fs.readFileSync(USER_PATH, 'utf-8')

    expect(agent.instructions['en-US']).toContain("In a user's message, first-person terms refer to the user")
    expect(agent.instructions['en-US']).toContain('`mcp__cherry-tools__config` describes this Agent')
    expect(agent.instructions['en-US']).toContain('Never transfer facts from one entity to another')
    expect(agent.instructions['zh-CN']).toContain('用户消息中的“我/我的/我们”指用户')
    expect(agent.instructions['zh-CN']).toContain('Agent 配置不能证明用户身份')
    expect(agent.instructions['zh-CN']).toContain('不能把一个主体的事实转移给另一个主体')
    expect(soul).toContain('Reference and ownership grounding')
    expect(user).toContain('Not provided')
    expect(user).toContain('not verified personal facts')
  })

  it('refuses destructive abuse and routes ordinary deletion through the operating-system trash', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as {
      instructions: Record<'en-US' | 'zh-CN', string>
    }
    const soul = fs.readFileSync(SOUL_PATH, 'utf-8')

    expect(agent.instructions['en-US']).toContain('including a Windows system drive such as C:')
    expect(agent.instructions['en-US']).toContain('mcp__assistant-files__move_to_trash')
    expect(agent.instructions['en-US']).toContain('Never use permanent deletion')
    expect(agent.instructions['en-US']).toContain('unauthorized access, malware, credential theft')
    expect(agent.instructions['zh-CN']).toContain('C 盘等系统盘')
    expect(agent.instructions['zh-CN']).toContain('取得第二次明确确认')
    expect(agent.instructions['zh-CN']).toContain('绝不永久删除')
    expect(agent.instructions['zh-CN']).toContain('安全、合法、防御性的替代方案')
    expect(soul).toContain('Never permanently delete user files')
    expect(soul).toContain('mcp__assistant-files__move_to_trash')
  })

  it('searches skills before declaring a capability unsupported and delegates creation to skill-creator', () => {
    const agent = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_PATH, 'utf-8')) as {
      instructions: Record<'en-US' | 'zh-CN', string>
    }
    const skillsManager = fs.readFileSync(SKILLS_MANAGER_PATH, 'utf-8')
    const marketplace = fs.readFileSync(MARKETPLACE_PATH, 'utf-8')

    expect(agent.instructions['en-US']).toContain('invoke `find-skills` to search')
    expect(agent.instructions['zh-CN']).toContain('不能停在“暂不支持”')
    expect(agent.instructions['zh-CN']).toContain('`find-skills` 可用时先调用它搜索')
    expect(agent.instructions['zh-CN']).toContain('`skill-creator` 可用就必须调用它')
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
    expect(agent.instructions['en-US']).toContain(
      'Collect or submit Cherry Studio feedback -> `cherry-studio-feedback`'
    )
    expect(agent.instructions['en-US']).toContain('File a GitHub Issue -> `issue-reporter`')
    expect(agent.instructions['zh-CN']).toContain('只收集用户同意的诊断信息')
    expect(agent.instructions['zh-CN']).toContain('默认提交到飞书')
    expect(feedback).toContain('mcp__assistant__diagnose({ action: "info" })')
    expect(feedback).toContain('mcp__assistant__diagnose({ action: "errors", lines: 100 })')
    expect(feedback).toContain('mcp__assistant-files__save_attachment')
    expect(feedback).toContain('外部提交前展示最终字段、附件文件名和接收方')
    expect(feedback).toContain('lark-cli base +form-detail')
    expect(feedback).toContain('auth status --json --verify')
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

  it('routes document conversion through content reconstruction without promising layout fidelity', () => {
    const docWriter = fs.readFileSync(DOC_WRITER_PATH, 'utf-8')

    expect(docWriter).toContain('PDF 转 Word')
    expect(docWriter).toContain('Word 转 PDF')
    expect(docWriter).toContain('内容重建式转换')
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
})
