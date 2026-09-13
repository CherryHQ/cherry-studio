export const REGRESSION_CASES = [
  { id: 'S-01', capabilities: [], phase: '01-startup', title: '应用启动冒烟测试', task: 'startup-smoke' },
  { id: 'APP-01', capabilities: [], phase: '02-basic-features', title: '打开小程序', task: 'mini-app' },
  { id: 'N-01', capabilities: [], phase: '02-basic-features', title: '创建和保存笔记', task: 'notes' },
  {
    id: 'M-02',
    capabilities: [],
    phase: '03-models-and-assistants',
    title: '配置自定义聊天服务商并完成聊天',
    task: 'custom-provider-chat'
  },
  {
    id: 'C-01',
    capabilities: [],
    phase: '03-models-and-assistants',
    title: '创建自定义助手并聊天',
    task: 'custom-assistant'
  },
  { id: 'T-01', capabilities: [], phase: '04-translation', title: '文本翻译', task: 'translation' },
  {
    id: 'T-02',
    capabilities: ['desktopAutomation'],
    phase: '04-translation',
    title: 'PDF 文件翻译',
    task: 'translation'
  },
  {
    id: 'C-02',
    capabilities: ['desktopAutomation'],
    phase: '05-desktop-assistants',
    title: '使用快捷助手完成全局问答',
    task: 'quick-assistant'
  },
  {
    id: 'C-03',
    capabilities: ['desktopAutomation'],
    phase: '05-desktop-assistants',
    title: '使用划词助手处理选中文本',
    task: 'selection-assistant'
  },
  {
    id: 'K-01',
    capabilities: ['desktopAutomation'],
    phase: '06-knowledge',
    title: '配置嵌入服务商并创建知识库',
    task: 'knowledge-import'
  },
  {
    id: 'K-02',
    capabilities: ['desktopAutomation'],
    phase: '06-knowledge',
    title: '基于知识库问答并验证引用',
    task: 'knowledge-qa'
  },
  {
    id: 'MCP-01',
    capabilities: ['npx'],
    phase: '07-integrations',
    title: '创建并使用 Everything MCP',
    task: 'everything-mcp'
  },
  {
    id: 'A-02',
    capabilities: ['desktopAutomation'],
    phase: '07-integrations',
    title: '从文件夹导入 Skill 并验证生效',
    task: 'skill-import'
  },
  {
    id: 'CODE-01',
    capabilities: ['desktopAutomation'],
    phase: '08-code-tools',
    title: '启动 Claude Code',
    task: 'code-cli'
  },
  { id: 'CODE-02', capabilities: ['desktopAutomation'], phase: '08-code-tools', title: '启动 Codex', task: 'code-cli' },
  { id: 'CODE-03', capabilities: [], phase: '08-code-tools', title: '启动 OpenClaw', task: 'openclaw' },
  {
    id: 'M-01',
    capabilities: [],
    phase: '09-cherryin-and-images',
    title: '登录 CherryIN 并完成聊天',
    task: 'cherryin-chat'
  },
  {
    id: 'P-01',
    capabilities: ['desktopAutomation'],
    phase: '09-cherryin-and-images',
    title: '使用图像模型生成图片',
    task: 'image-generation'
  },
  {
    id: 'A-03',
    capabilities: ['desktopAutomation'],
    phase: '10-agent-runtimes',
    title: 'Claude Agent Runtime',
    task: 'claude-agent-runtime'
  },
  {
    id: 'A-04',
    capabilities: ['desktopAutomation'],
    phase: '10-agent-runtimes',
    title: 'Pi Runtime',
    task: 'pi-runtime'
  },
  {
    id: 'A-05',
    capabilities: ['desktopAutomation'],
    phase: '10-agent-runtimes',
    title: 'DeepSeek Harness Runtime',
    task: 'deepseek-harness-runtime'
  },
  {
    id: 'A-01',
    capabilities: ['desktopAutomation'],
    phase: '10-agent-runtimes',
    title: '默认 Agent 完成基础文件任务',
    task: 'agent-basic-task'
  }
] as const

export type RegressionCase = (typeof REGRESSION_CASES)[number]
export type CaseId = RegressionCase['id']
export type TaskId = RegressionCase['task']
export type PhaseId = RegressionCase['phase']
export type TaskSelection = 'all' | TaskId

export const TASK_IDS = [...new Set(REGRESSION_CASES.map(({ task }) => task))]
export const TASK_SELECTIONS = ['all', ...TASK_IDS] as const
export const PHASE_IDS = [...new Set(REGRESSION_CASES.map(({ phase }) => phase))]

export function getCase(id: string): RegressionCase {
  const testCase = REGRESSION_CASES.find((candidate) => candidate.id === id)
  if (!testCase) throw new Error(`Unknown regression case: ${id}`)
  return testCase
}

export function selectCases(task: TaskSelection, phase?: PhaseId): RegressionCase[] {
  return REGRESSION_CASES.filter(
    (testCase) => (task === 'all' || testCase.task === task) && (!phase || testCase.phase === phase)
  )
}

export function caseDefinition(id: CaseId) {
  const testCase = getCase(id)
  return [
    `[${id}] ${testCase.title}`,
    { tag: `@${testCase.task}`, annotation: { type: 'regression-case', description: id } }
  ] as const
}

export function missingCapabilities(id: CaseId, capabilities: Record<string, { available: boolean }>): string[] {
  return getCase(id).capabilities.filter((name) => !capabilities[name]?.available)
}
