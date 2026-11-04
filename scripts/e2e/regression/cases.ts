import type { Platform } from './types'

export const REGRESSION_CASES = [
  {
    id: 'S-01',
    capabilities: [],
    phase: 'startup',
    title: 'Application startup smoke test',
    tasks: ['startup-smoke']
  },
  {
    id: 'APP-01',
    capabilities: [],
    phase: 'basicFeatures',
    title: 'Open a Mini App',
    tasks: ['mini-app', 'mini-app-smoke']
  },
  {
    id: 'N-01',
    capabilities: [],
    phase: 'basicFeatures',
    title: 'Create and save a note',
    tasks: ['notes', 'notes-smoke']
  },
  {
    id: 'MP-103',
    title: 'Pin Mini Apps to the sidebar or launchpad',
    tasks: ['mini-app', 'mini-app-pinning'],
    phase: 'basicFeatures',
    capabilities: []
  },
  {
    id: 'M-02',
    capabilities: [],
    phase: 'modelsAndAssistants',
    title: 'Configure a custom chat provider and send a message',
    tasks: ['settings', 'custom-provider-chat']
  },
  {
    id: 'M-03',
    capabilities: [],
    phase: 'modelsAndAssistants',
    title: 'Scroll provider models from outside the list without sticky groups',
    tasks: ['settings', 'provider-model-scroll']
  },
  {
    id: 'C-01',
    capabilities: [],
    phase: 'modelsAndAssistants',
    title: 'Create a custom assistant and chat',
    tasks: ['assistants', 'custom-assistant']
  },
  {
    id: 'C-03',
    capabilities: [],
    phase: 'modelsAndAssistants',
    title: 'Preserve a partial chat response after disconnect and restart',
    tasks: ['error-recovery', 'chat-stream-failure']
  },
  {
    id: 'MP-42',
    capabilities: [],
    phase: 'modelsAndAssistants',
    title: 'Clear chat messages',
    tasks: ['chat-core', 'clear-chat-messages']
  },
  {
    id: 'MP-17',
    title: 'Error messages and one-click recovery',
    tasks: ['error-recovery', 'chat-error-recovery'],
    phase: 'modelsAndAssistants',
    capabilities: []
  },
  {
    id: 'T-01',
    capabilities: [],
    phase: 'translationSmoke',
    title: 'Translate text',
    tasks: ['translation', 'translation-smoke']
  },
  {
    id: 'C-02',
    capabilities: ['desktopAutomation'],
    phase: 'desktopAssistants',
    title: 'Ask a question using Quick Assistant',
    tasks: ['system-integration', 'quick-assistant']
  },
  {
    id: 'MP-59',
    title: 'Create a knowledge base (name, embedding model, group)',
    tasks: ['knowledge'],
    phase: 'knowledge',
    capabilities: []
  },
  {
    id: 'MP-67',
    title: 'Rename, move, and delete knowledge bases',
    tasks: ['knowledge'],
    phase: 'knowledge',
    capabilities: []
  },
  {
    id: 'MP-139',
    title: 'Tool settings (web search, file processing)',
    tasks: ['mcp-skills'],
    phase: 'integrations',
    capabilities: []
  },
  {
    id: 'MP-138',
    title: 'Trigger skills in chat',
    tasks: ['mcp-skills'],
    phase: 'integrations',
    capabilities: []
  },
  {
    id: 'CODE-03',
    capabilities: ['desktopAutomation'],
    phase: 'codeTools',
    title: 'Launch OpenClaw',
    tasks: ['code-tools', 'openclaw']
  },
  {
    id: 'M-01',
    capabilities: [],
    phase: 'cherryIn',
    title: 'Sign in to CherryIN and chat',
    tasks: ['chat-core', 'cherryin-chat']
  },
  {
    id: 'MP-91',
    title: 'Prompt templates and enhancement',
    tasks: ['paintings'],
    phase: 'images',
    capabilities: []
  },
  {
    id: 'MP-53',
    title: 'Rename, switch, and delete workspaces',
    tasks: ['agents'],
    phase: 'agentRuntimes',
    capabilities: []
  },
  {
    id: 'MP-58',
    title: 'Scheduled tasks (create, run now, pause, history)',
    tasks: ['agents'],
    phase: 'agentRuntimes',
    capabilities: []
  },
  {
    id: 'MP-43',
    title: 'Rename topics and generate names automatically',
    tasks: ['topics'],
    phase: 'topics',
    capabilities: []
  },
  {
    id: 'MP-44',
    title: 'Pin topics and reorder by dragging',
    tasks: ['topics'],
    phase: 'topics',
    capabilities: []
  },
  { id: 'MP-45', title: 'Topic group display modes', tasks: ['topics'], phase: 'topics', capabilities: [] },
  { id: 'MP-10', title: 'Web search', tasks: ['chat-core'], phase: 'chatCore', capabilities: [] },
  {
    id: 'MP-27',
    capabilities: [],
    phase: 'chatCore',
    title: 'Input interactions (newlines, topic references, slash commands, height)',
    tasks: ['chat-core']
  },
  {
    id: 'MP-29',
    title: 'Branch messages and copy to a new chat',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: []
  },
  {
    id: 'MP-30',
    title: 'Manage context (/context, /compact, /clear)',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: []
  },
  {
    id: 'MP-32',
    title: 'Image attachments and multimodal understanding',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: []
  },
  { id: 'MP-35', title: 'Web search and URL fetching', tasks: ['chat-core'], phase: 'chatCore', capabilities: [] },
  { id: 'MP-37', title: 'Generate images in chat', tasks: ['chat-core'], phase: 'chatCore', capabilities: [] },
  {
    id: 'MP-39',
    title: 'Message token and timing details',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: []
  },
  {
    id: 'MP-41',
    title: 'Preview HTML Artifacts',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: []
  },
  {
    id: 'MP-75',
    title: 'Drag to import Markdown files or folders',
    tasks: ['notes'],
    phase: 'notes',
    capabilities: []
  },
  { id: 'MP-76', title: 'Search notes by name and content', tasks: ['notes'], phase: 'notes', capabilities: [] },
  {
    id: 'MP-78',
    title: 'Star and sort notes',
    tasks: ['notes'],
    phase: 'notes',
    capabilities: []
  },
  { id: 'MP-79', title: 'Export notes to a knowledge base', tasks: ['notes'], phase: 'notes', capabilities: [] },
  {
    id: 'MP-81',
    title: 'Translation history (favorite, reuse, delete, clear)',
    tasks: ['translation'],
    phase: 'translation',
    capabilities: []
  },
  {
    id: 'MP-82',
    title: 'Translate files by dragging documents',
    tasks: ['translation'],
    phase: 'translation',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-83',
    title: 'Translate images with OCR',
    tasks: ['translation'],
    phase: 'translation',
    capabilities: []
  },
  {
    id: 'MP-85',
    title: 'Custom languages',
    tasks: ['translation'],
    phase: 'translation',
    capabilities: []
  },
  {
    id: 'MP-86',
    title: 'Translation settings (model, auto-copy, detection method)',
    tasks: ['translation', 'translation-settings'],
    phase: 'translation',
    capabilities: []
  },
  {
    id: 'MP-06',
    title: 'Change settings and preserve them after restart',
    tasks: ['settings'],
    phase: 'settings',
    capabilities: []
  },
  {
    id: 'MP-104',
    capabilities: [],
    phase: 'settings',
    title: 'Open, search, and navigate settings sections',
    tasks: ['settings']
  },
  {
    id: 'MP-106',
    title: 'Fonts, font size, and zoom',
    tasks: ['settings'],
    phase: 'settings',
    capabilities: []
  },
  {
    id: 'MP-112',
    title: 'Network proxy settings',
    tasks: ['settings'],
    phase: 'settings',
    capabilities: ['lanInterface']
  },
  {
    id: 'MP-26',
    title: 'Switch models in chat',
    tasks: ['assistants'],
    phase: 'assistants',
    capabilities: []
  },
  { id: 'MP-69', title: 'Filter files by category and search', tasks: ['files'], phase: 'files', capabilities: [] },
  {
    id: 'MP-115',
    title: 'Local backups and backup file management',
    tasks: ['data-backup'],
    phase: 'dataManagement',
    capabilities: []
  },
  {
    id: 'MP-116',
    title: 'Restore from a local backup',
    tasks: ['data-backup'],
    phase: 'dataManagement',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-117',
    title: 'Automatic backups and retention count',
    tasks: ['data-backup'],
    phase: 'dataManagement',
    capabilities: []
  },
  {
    id: 'MP-122',
    title: 'Open and navigate web pages in the built-in browser',
    tasks: ['browser'],
    phase: 'browser',
    capabilities: []
  },
  {
    id: 'MP-124',
    title: 'Open chat links and tool results in the built-in browser',
    tasks: ['browser'],
    phase: 'browser',
    capabilities: []
  },
  {
    id: 'MP-125',
    title: 'Page load failures and local service disconnections',
    tasks: ['browser'],
    phase: 'browser',
    capabilities: []
  },
  {
    id: 'MP-130',
    title: 'Pin and open launchpad items',
    tasks: ['system-integration'],
    phase: 'system',
    capabilities: []
  },
  {
    id: 'MP-131',
    title: 'Multiple tabs and windows',
    tasks: ['system-integration'],
    phase: 'system',
    capabilities: []
  }
] as const

export type RegressionCase = (typeof REGRESSION_CASES)[number]
export type CaseId = RegressionCase['id']
export type TaskId = RegressionCase['tasks'][number]
export type PhaseId = RegressionCase['phase']
export type TaskSelection = 'all' | TaskId

export const TASK_IDS = [
  ...new Set([
    ...REGRESSION_CASES.map(({ tasks }) => tasks[0]),
    ...REGRESSION_CASES.flatMap(({ tasks }) => tasks.slice(1))
  ])
]
export const TASK_SELECTIONS = ['all', ...TASK_IDS] as const
export const PHASE_IDS = [...new Set(REGRESSION_CASES.map(({ phase }) => phase))]

export function getCase(id: string): RegressionCase {
  const testCase = REGRESSION_CASES.find((candidate) => candidate.id === id)
  if (!testCase) throw new Error(`Unknown regression case: ${id}`)
  return testCase
}

export function selectCases(task: TaskSelection, phase?: PhaseId): RegressionCase[] {
  return REGRESSION_CASES.filter(
    (testCase) =>
      (task === 'all' || testCase.tasks.some((candidate) => candidate === task)) && (!phase || testCase.phase === phase)
  )
}

export function caseDefinition(id: CaseId) {
  const testCase = getCase(id)
  return [
    `[${id}] ${testCase.title}`,
    { tag: testCase.tasks.map((task) => `@${task}`), annotation: { type: 'regression-case', description: id } }
  ] as const
}

export function missingCapabilities(id: CaseId, capabilities: Record<string, { available: boolean }>): string[] {
  return getCase(id).capabilities.filter((name) => !capabilities[name]?.available)
}

/**
 * A case may be implemented for a subset of the platforms the regression
 * workflow runs on — native notification automation, System Events driven
 * tray and single-instance checks, and Terminal permission flows only exist on
 * macOS. Such cases declare `platforms`; runs on the other platform record
 * them as not applicable instead of executing a macOS-only implementation and
 * reporting an application failure.
 */
export function supportsPlatform(id: CaseId, platform: Platform): boolean {
  const { platforms } = getCase(id) as { platforms?: readonly Platform[] }
  return !platforms || platforms.includes(platform)
}
