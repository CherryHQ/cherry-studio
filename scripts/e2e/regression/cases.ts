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
    id: 'T-02',
    capabilities: ['desktopAutomation'],
    phase: 'translationSmoke',
    title: 'Translate a PDF file',
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
    id: 'K-01',
    capabilities: ['desktopAutomation'],
    phase: 'knowledge',
    title: 'Create a knowledge base, verify persistence, and answer with citations',
    tasks: ['knowledge', 'knowledge-smoke']
  },
  {
    id: 'MP-59',
    title: 'Create a knowledge base (name, embedding model, group)',
    tasks: ['knowledge'],
    phase: 'knowledge',
    capabilities: []
  },
  {
    id: 'MP-60',
    capabilities: ['desktopAutomation'],
    phase: 'knowledge',
    title: 'Process file sources until ready',
    tasks: ['knowledge']
  },
  {
    id: 'MP-61',
    title: 'Import directory sources',
    tasks: ['knowledge'],
    phase: 'knowledge',
    capabilities: ['desktopAutomation']
  },
  { id: 'MP-62', title: 'Fetch link sources', tasks: ['knowledge'], phase: 'knowledge', capabilities: [] },
  {
    id: 'MP-63',
    title: 'Note sources',
    tasks: ['knowledge'],
    phase: 'knowledge',
    capabilities: []
  },
  {
    id: 'MP-64',
    title: 'Resolve duplicate source names',
    tasks: ['knowledge'],
    phase: 'knowledge',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-65',
    title: 'Source actions (preview, chunks, reindex, delete)',
    tasks: ['knowledge'],
    phase: 'knowledge',
    capabilities: []
  },
  {
    id: 'MP-66',
    title: 'Retrieval settings and recall verification',
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
    id: 'MCP-01',
    capabilities: ['npx'],
    phase: 'integrations',
    title: 'Create and use Everything MCP',
    tasks: ['mcp-skills', 'everything-mcp']
  },
  {
    id: 'A-02',
    capabilities: ['desktopAutomation'],
    phase: 'integrations',
    title: 'Import a Skill from a folder and verify it works',
    tasks: ['mcp-skills', 'skill-import']
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
    id: 'CODE-01',
    capabilities: ['desktopAutomation'],
    phase: 'codeTools',
    title: 'Launch Claude Code',
    tasks: ['code-tools', 'code-cli']
  },
  {
    id: 'CODE-02',
    capabilities: ['desktopAutomation'],
    phase: 'codeTools',
    title: 'Launch Codex',
    tasks: ['code-tools', 'code-cli']
  },
  {
    id: 'CODE-03',
    capabilities: ['desktopAutomation'],
    phase: 'codeTools',
    title: 'Launch OpenClaw',
    tasks: ['code-tools', 'openclaw']
  },
  {
    id: 'MP-97',
    title: 'Advanced parameters and permission modes',
    tasks: ['code-tools', 'code-cli-permissions'],
    phase: 'codeTools',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  {
    id: 'M-01',
    capabilities: [],
    phase: 'cherryIn',
    title: 'Sign in to CherryIN and chat',
    tasks: ['chat-core', 'cherryin-chat']
  },
  {
    id: 'P-01',
    capabilities: ['desktopAutomation'],
    phase: 'cherryIn',
    title: 'Generate an image using an image model',
    tasks: ['paintings', 'image-generation']
  },
  {
    id: 'MP-90',
    title: 'Enlarge, preview, and save images',
    tasks: ['paintings'],
    phase: 'images',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-91',
    title: 'Prompt templates and enhancement',
    tasks: ['paintings'],
    phase: 'images',
    capabilities: []
  },
  {
    id: 'MP-92',
    title: 'Image generation errors and quota alerts',
    tasks: ['paintings'],
    phase: 'images',
    capabilities: []
  },
  {
    id: 'A-01',
    capabilities: ['desktopAutomation'],
    phase: 'agentRuntimes',
    title: 'Complete a basic file task with the default Agent',
    tasks: ['agents', 'agent-basic-task']
  },
  {
    id: 'A-03',
    capabilities: ['desktopAutomation'],
    phase: 'agentRuntimes',
    title: 'Claude Agent Runtime',
    tasks: ['agents', 'claude-agent-runtime']
  },
  {
    id: 'A-04',
    capabilities: ['desktopAutomation'],
    phase: 'agentRuntimes',
    title: 'Pi Runtime',
    tasks: ['agents', 'pi-runtime']
  },
  {
    id: 'MP-144',
    title: 'Send messages to a running Agent (steer, queue)',
    tasks: ['agents'],
    phase: 'agentRuntimes',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-145',
    title: 'Create scheduled tasks in Agent chat and view or trigger task cards',
    tasks: ['agents'],
    phase: 'agentRuntimes',
    capabilities: []
  },
  {
    id: 'MP-19',
    title: 'Agent side preview (files, pasted text, generated files)',
    tasks: ['agents'],
    phase: 'agentRuntimes',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-51',
    title: 'Confirm each permission request (allow, deny)',
    tasks: ['agents'],
    phase: 'agentRuntimes',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-52',
    title: 'Sync Agent file edits with the side preview',
    tasks: ['agents'],
    phase: 'agentRuntimes',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  {
    id: 'MP-53',
    title: 'Rename, switch, and delete workspaces',
    tasks: ['agents'],
    phase: 'agentRuntimes',
    capabilities: []
  },
  {
    id: 'MP-54',
    title: 'Search, pin, and group Agent sessions',
    tasks: ['agents'],
    phase: 'agentRuntimes',
    capabilities: []
  },
  {
    id: 'MP-55',
    title: 'Side status panel (tasks, tools, context)',
    tasks: ['agents'],
    phase: 'agentRuntimes',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-56',
    title: 'Interrupt tasks and clean up background processes',
    tasks: ['agents'],
    phase: 'agentRuntimes',
    capabilities: []
  },
  {
    id: 'MP-57',
    title: 'Agent memory and context sources',
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
    id: 'MP-05',
    title: 'Multiple topics and history persistence',
    tasks: ['topics'],
    phase: 'topics',
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
  { id: 'MP-46', title: 'Bulk delete and move topics', tasks: ['topics'], phase: 'topics', capabilities: [] },
  {
    id: 'MP-47',
    title: 'Export topics as Markdown, Word, or images',
    tasks: ['topics'],
    phase: 'topics',
    capabilities: ['desktopAutomation']
  },
  { id: 'MP-48', title: 'Save and restore chat drafts', tasks: ['topics'], phase: 'topics', capabilities: [] },
  {
    id: 'MP-09',
    title: 'Attach files and images',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: ['desktopAutomation', 'screenCapture']
  },
  { id: 'MP-10', title: 'Web search', tasks: ['chat-core'], phase: 'chatCore', capabilities: [] },
  {
    id: 'MP-149',
    title: 'Copy and quote popover for selected message text',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: []
  },
  {
    id: 'MP-16',
    title: 'Polish prompts',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: []
  },
  {
    id: 'MP-18',
    title: 'Chat shortcuts (message queue, hover cards, attachment context menu, image preview)',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-27',
    capabilities: [],
    phase: 'chatCore',
    title: 'Input interactions (newlines, topic references, slash commands, height)',
    tasks: ['chat-core']
  },
  {
    id: 'MP-28',
    title: 'Message actions (copy, quote, edit and resend, regenerate, delete, read aloud)',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: []
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
  {
    id: 'MP-33',
    title: 'Drag uploads, paste long text, and handle unsupported types',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: []
  },
  {
    id: 'MP-34',
    title: 'Mutual exclusion of knowledge references and attachments',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: ['desktopAutomation']
  },
  { id: 'MP-35', title: 'Web search and URL fetching', tasks: ['chat-core'], phase: 'chatCore', capabilities: [] },
  {
    id: 'MP-36',
    title: 'Reference MCP prompts and resources',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: []
  },
  { id: 'MP-37', title: 'Generate images in chat', tasks: ['chat-core'], phase: 'chatCore', capabilities: [] },
  { id: 'MP-38', title: 'Search messages in chat', tasks: ['chat-core'], phase: 'chatCore', capabilities: [] },
  {
    id: 'MP-39',
    title: 'Message token and timing details',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: []
  },
  {
    id: 'MP-40',
    title: 'Code block toolbar',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-41',
    title: 'Preview HTML Artifacts',
    tasks: ['chat-core'],
    phase: 'chatCore',
    capabilities: []
  },
  { id: 'MP-11', title: 'Notes and export', tasks: ['notes'], phase: 'notes', capabilities: [] },
  {
    id: 'MP-74',
    title: 'Markdown editing, autosave, and conflicts',
    tasks: ['notes'],
    phase: 'notes',
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
    id: 'MP-77',
    title: 'Export notes to PDF or Word and print',
    tasks: ['notes'],
    phase: 'notes',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
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
    id: 'MP-105',
    title: 'Theme, appearance, and window style',
    tasks: ['settings'],
    phase: 'settings',
    capabilities: [],
    platforms: ['macos']
  },
  {
    id: 'MP-106',
    title: 'Fonts, font size, and zoom',
    tasks: ['settings'],
    phase: 'settings',
    capabilities: []
  },
  {
    id: 'MP-107',
    title: 'Message and input settings',
    tasks: ['settings'],
    phase: 'settings',
    capabilities: []
  },
  { id: 'MP-108', title: 'Assign default models', tasks: ['settings'], phase: 'settings', capabilities: [] },
  {
    id: 'MP-109',
    title: 'Customize shortcuts and detect conflicts',
    tasks: ['settings'],
    phase: 'settings',
    capabilities: []
  },
  {
    id: 'MP-110',
    title: 'Notification settings',
    tasks: ['settings'],
    phase: 'settings',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  {
    id: 'MP-111',
    capabilities: ['desktopAutomation'],
    phase: 'settings',
    title: 'Startup and tray behavior',
    tasks: ['settings'],
    platforms: ['macos']
  },
  {
    id: 'MP-112',
    title: 'Network proxy settings',
    tasks: ['settings'],
    phase: 'settings',
    capabilities: ['lanInterface']
  },
  {
    id: 'MP-151',
    title: 'Channels: Feishu bot and group mentions-only toggle',
    tasks: ['settings'],
    phase: 'settings',
    capabilities: []
  },
  {
    id: 'MP-113',
    title: 'Privacy settings and error reporting toggle',
    tasks: ['settings'],
    phase: 'settings',
    capabilities: []
  },
  {
    id: 'MP-114',
    title: 'About page, update checks, and diagnostic export',
    tasks: ['settings'],
    phase: 'settings',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-147',
    title: 'Expand long user messages by default',
    tasks: ['settings'],
    phase: 'settings',
    capabilities: []
  },
  {
    id: 'MP-20',
    title: 'Create a chat from the home page and send a message',
    tasks: ['assistants'],
    phase: 'assistants',
    capabilities: []
  },
  {
    id: 'MP-22',
    title: 'Edit, sort, pin, and delete assistants',
    tasks: ['assistants'],
    phase: 'assistants',
    capabilities: []
  },
  {
    id: 'MP-23',
    title: 'Export and import assistants',
    tasks: ['assistants'],
    phase: 'assistants',
    capabilities: ['desktopAutomation']
  },
  { id: 'MP-24', title: 'Manage assistant groups', tasks: ['assistants'], phase: 'assistants', capabilities: [] },
  {
    id: 'MP-25',
    title: 'Move chats to other assistants',
    tasks: ['assistants'],
    phase: 'assistants',
    capabilities: []
  },
  {
    id: 'MP-26',
    title: 'Switch models in chat',
    tasks: ['assistants'],
    phase: 'assistants',
    capabilities: []
  },
  {
    id: 'MP-150',
    title: 'Preview RTF in Files and preserve Chat attachments',
    tasks: ['files'],
    phase: 'files',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-68',
    title: 'Upload files to the library',
    tasks: ['files'],
    phase: 'files',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  { id: 'MP-69', title: 'Filter files by category and search', tasks: ['files'], phase: 'files', capabilities: [] },
  {
    id: 'MP-70',
    title: 'Preview files and open their location',
    tasks: ['files'],
    phase: 'files',
    capabilities: []
  },
  {
    id: 'MP-71',
    title: 'Rename, delete, and remove files',
    tasks: ['files'],
    phase: 'files',
    capabilities: []
  },
  {
    id: 'MP-72',
    title: 'Reference library files in chat',
    tasks: ['files'],
    phase: 'files',
    capabilities: [],
    platforms: ['macos']
  },
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
  { id: 'MP-118', title: 'Clear cache by category', tasks: ['data-backup'], phase: 'dataManagement', capabilities: [] },
  {
    id: 'MP-119',
    title: 'Migrate the application data directory',
    tasks: ['data-backup'],
    phase: 'dataManagement',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-120',
    title: 'Import ChatGPT or Claude data',
    tasks: ['data-backup'],
    phase: 'dataManagement',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-121',
    title: 'Reset application data (run last)',
    tasks: ['data-backup'],
    phase: 'dataManagement',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  {
    id: 'MP-122',
    title: 'Open and navigate web pages in the built-in browser',
    tasks: ['browser'],
    phase: 'browser',
    capabilities: []
  },
  { id: 'MP-123', title: 'Annotate web pages', tasks: ['browser'], phase: 'browser', capabilities: [] },
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
    id: 'MP-127',
    capabilities: ['externalSelection', 'globalShortcut'],
    phase: 'system',
    title: 'Selection Assistant (capture, explain, translate, copy)',
    tasks: ['system-integration'],
    platforms: ['macos']
  },
  {
    id: 'MP-128',
    title: 'Screenshot tool (region, annotate, copy, OCR, add to chat)',
    tasks: ['system-integration'],
    phase: 'system',
    capabilities: ['desktopAutomation', 'screenCapture']
  },
  {
    id: 'MP-129',
    title: 'Global search across types and jump to messages',
    tasks: ['system-integration'],
    phase: 'system',
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
  },
  {
    id: 'MP-132',
    title: 'System tray menu',
    tasks: ['system-integration'],
    phase: 'system',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  {
    id: 'MP-133',
    title: 'Deep links, single instance, and relaunch',
    tasks: ['system-integration'],
    phase: 'system',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  {
    id: 'MP-140',
    title: 'Computer Use permissions and desktop control toggle',
    tasks: ['system-integration'],
    phase: 'system',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  {
    id: 'MP-141',
    title: 'Device connections (phone pairing, network access)',
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
