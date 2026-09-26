export const REGRESSION_CASES = [
  { id: 'S-01', capabilities: [], phase: '01-startup', title: 'Application startup smoke test', task: 'startup-smoke' },
  { id: 'APP-01', capabilities: [], phase: '02-basic-features', title: 'Open a Mini App', task: 'mini-app' },
  { id: 'N-01', capabilities: [], phase: '02-basic-features', title: 'Create and save a note', task: 'notes' },
  {
    id: 'M-02',
    capabilities: [],
    phase: '03-models-and-assistants',
    title: 'Configure a custom chat provider and send a message',
    task: 'custom-provider-chat'
  },
  {
    id: 'M-03',
    capabilities: [],
    phase: '03-models-and-assistants',
    title: 'Scroll provider models from outside the list without sticky groups',
    task: 'provider-model-scroll'
  },
  {
    id: 'C-01',
    capabilities: [],
    phase: '03-models-and-assistants',
    title: 'Create a custom assistant and chat',
    task: 'custom-assistant'
  },
  { id: 'T-01', capabilities: [], phase: '04-translation', title: 'Translate text', task: 'translation' },
  {
    id: 'T-02',
    capabilities: ['desktopAutomation'],
    phase: '04-translation',
    title: 'Translate a PDF file',
    task: 'translation'
  },
  {
    id: 'C-02',
    capabilities: ['desktopAutomation'],
    phase: '05-desktop-assistants',
    title: 'Ask a question using Quick Assistant',
    task: 'quick-assistant'
  },
  {
    id: 'K-01',
    capabilities: ['desktopAutomation'],
    phase: '06-knowledge',
    title: 'Create a knowledge base, verify persistence, and answer with citations',
    task: 'knowledge'
  },
  {
    id: 'MCP-01',
    capabilities: ['npx'],
    phase: '07-integrations',
    title: 'Create and use Everything MCP',
    task: 'everything-mcp'
  },
  {
    id: 'A-02',
    capabilities: ['desktopAutomation'],
    phase: '07-integrations',
    title: 'Import a Skill from a folder and verify it works',
    task: 'skill-import'
  },
  {
    id: 'CODE-01',
    capabilities: ['desktopAutomation'],
    phase: '08-code-tools',
    title: 'Launch Claude Code',
    task: 'code-cli'
  },
  {
    id: 'CODE-02',
    capabilities: ['desktopAutomation'],
    phase: '08-code-tools',
    title: 'Launch Codex',
    task: 'code-cli'
  },
  { id: 'CODE-03', capabilities: [], phase: '08-code-tools', title: 'Launch OpenClaw', task: 'openclaw' },
  {
    id: 'M-01',
    capabilities: [],
    phase: '09-cherryin-and-images',
    title: 'Sign in to CherryIN and chat',
    task: 'cherryin-chat'
  },
  {
    id: 'P-01',
    capabilities: ['desktopAutomation'],
    phase: '09-cherryin-and-images',
    title: 'Generate an image using an image model',
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
    title: 'Complete a basic file task with the default Agent',
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
