import type { Platform } from './types'

export const REGRESSION_CASES = [
  { id: 'S-01', capabilities: [], phase: '01-startup', title: 'Application startup smoke test', task: 'startup-smoke' },
  { id: 'APP-01', capabilities: [], phase: '02-basic-features', title: 'Open a Mini App', task: 'mini-app' },
  { id: 'N-01', capabilities: [], phase: '02-basic-features', title: 'Create and save a note', task: 'notes' },
  {
    id: 'MP-103',
    title: 'Pin Mini Apps to the sidebar or launchpad',
    task: '02-basic-features',
    phase: '02-basic-features',
    capabilities: []
  },
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
  {
    id: 'C-03',
    capabilities: [],
    phase: '03-models-and-assistants',
    title: 'Preserve a partial chat response after disconnect and restart',
    task: 'chat-stream-failure'
  },
  {
    id: 'MP-42',
    capabilities: [],
    phase: '03-models-and-assistants',
    title: 'Clear chat messages',
    task: 'clear-chat-messages'
  },
  {
    id: 'MP-17',
    title: 'Error messages and one-click recovery',
    task: '03-models-and-assistants',
    phase: '03-models-and-assistants',
    capabilities: []
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
    id: 'MP-59',
    title: 'Create a knowledge base (name, embedding model, group)',
    task: '06-knowledge',
    phase: '06-knowledge',
    capabilities: []
  },
  {
    id: 'MP-60',
    capabilities: ['desktopAutomation'],
    phase: '06-knowledge',
    title: 'Process file sources until ready',
    task: '06-knowledge'
  },
  {
    id: 'MP-61',
    title: 'Import directory sources',
    task: '06-knowledge',
    phase: '06-knowledge',
    capabilities: ['desktopAutomation']
  },
  { id: 'MP-62', title: 'Fetch link sources', task: '06-knowledge', phase: '06-knowledge', capabilities: [] },
  {
    id: 'MP-63',
    title: 'Note sources',
    task: '06-knowledge',
    phase: '06-knowledge',
    capabilities: []
  },
  {
    id: 'MP-64',
    title: 'Resolve duplicate source names',
    task: '06-knowledge',
    phase: '06-knowledge',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-65',
    title: 'Source actions (preview, chunks, reindex, delete)',
    task: '06-knowledge',
    phase: '06-knowledge',
    capabilities: []
  },
  {
    id: 'MP-66',
    title: 'Retrieval settings and recall verification',
    task: '06-knowledge',
    phase: '06-knowledge',
    capabilities: []
  },
  {
    id: 'MP-67',
    title: 'Rename, move, and delete knowledge bases',
    task: '06-knowledge',
    phase: '06-knowledge',
    capabilities: []
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
    id: 'MP-139',
    title: 'Tool settings (web search, file processing)',
    task: '07-integrations',
    phase: '07-integrations',
    capabilities: []
  },
  {
    id: 'MP-138',
    title: 'Trigger skills in chat',
    task: '07-integrations',
    phase: '07-integrations',
    capabilities: []
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
  {
    id: 'CODE-03',
    capabilities: ['desktopAutomation'],
    phase: '08-code-tools',
    title: 'Launch OpenClaw',
    task: 'openclaw'
  },
  {
    id: 'MP-97',
    title: 'Advanced parameters and permission modes',
    task: '08-code-tools',
    phase: '08-code-tools',
    capabilities: [],
    platforms: ['macos']
  },
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
    id: 'MP-90',
    title: 'Enlarge, preview, and save images',
    task: '09-images',
    phase: '09-images',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  { id: 'MP-91', title: 'Prompt templates and enhancement', task: '09-images', phase: '09-images', capabilities: [] },
  {
    id: 'MP-92',
    title: 'Image generation errors and quota alerts',
    task: '09-images',
    phase: '09-images',
    capabilities: []
  },
  {
    id: 'A-01',
    capabilities: ['desktopAutomation'],
    phase: '10-agent-runtimes',
    title: 'Complete a basic file task with the default Agent',
    task: 'agent-basic-task'
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
    id: 'MP-144',
    title: 'Send messages to a running Agent (steer, queue)',
    task: '10-agent-runtimes',
    phase: '10-agent-runtimes',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-145',
    title: 'Create scheduled tasks in Agent chat and view or trigger task cards',
    task: '10-agent-runtimes',
    phase: '10-agent-runtimes',
    capabilities: []
  },
  {
    id: 'MP-19',
    title: 'Agent side preview (files, pasted text, generated files)',
    task: '10-agent-runtimes',
    phase: '10-agent-runtimes',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-51',
    title: 'Confirm each permission request (allow, deny)',
    task: '10-agent-runtimes',
    phase: '10-agent-runtimes',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-52',
    title: 'Sync Agent file edits with the side preview',
    task: '10-agent-runtimes',
    phase: '10-agent-runtimes',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  {
    id: 'MP-53',
    title: 'Rename, switch, and delete workspaces',
    task: '10-agent-runtimes',
    phase: '10-agent-runtimes',
    capabilities: []
  },
  {
    id: 'MP-54',
    title: 'Search, pin, and group Agent sessions',
    task: '10-agent-runtimes',
    phase: '10-agent-runtimes',
    capabilities: []
  },
  {
    id: 'MP-55',
    title: 'Side status panel (tasks, tools, context)',
    task: '10-agent-runtimes',
    phase: '10-agent-runtimes',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-56',
    title: 'Interrupt tasks and clean up background processes',
    task: '10-agent-runtimes',
    phase: '10-agent-runtimes',
    capabilities: [],
    platforms: ['macos']
  },
  {
    id: 'MP-57',
    title: 'Agent memory and context sources',
    task: '10-agent-runtimes',
    phase: '10-agent-runtimes',
    capabilities: []
  },
  {
    id: 'MP-58',
    title: 'Scheduled tasks (create, run now, pause, history)',
    task: '10-agent-runtimes',
    phase: '10-agent-runtimes',
    capabilities: []
  },
  {
    id: 'MP-05',
    title: 'Multiple topics and history persistence',
    task: '12-topics',
    phase: '12-topics',
    capabilities: []
  },
  {
    id: 'MP-43',
    title: 'Rename topics and generate names automatically',
    task: '12-topics',
    phase: '12-topics',
    capabilities: []
  },
  {
    id: 'MP-44',
    title: 'Pin topics and reorder by dragging',
    task: '12-topics',
    phase: '12-topics',
    capabilities: []
  },
  { id: 'MP-45', title: 'Topic group display modes', task: '12-topics', phase: '12-topics', capabilities: [] },
  { id: 'MP-46', title: 'Bulk delete and move topics', task: '12-topics', phase: '12-topics', capabilities: [] },
  {
    id: 'MP-47',
    title: 'Export topics as Markdown, Word, or images',
    task: '12-topics',
    phase: '12-topics',
    capabilities: ['desktopAutomation']
  },
  { id: 'MP-48', title: 'Save and restore chat drafts', task: '12-topics', phase: '12-topics', capabilities: [] },
  {
    id: 'MP-09',
    title: 'Attach files and images',
    task: '13-chat-core',
    phase: '13-chat-core',
    capabilities: ['desktopAutomation']
  },
  { id: 'MP-10', title: 'Web search', task: '13-chat-core', phase: '13-chat-core', capabilities: [] },
  {
    id: 'MP-149',
    title: 'Copy and quote popover for selected message text',
    task: '13-chat-core',
    phase: '13-chat-core',
    capabilities: []
  },
  {
    id: 'MP-16',
    title: 'Polish prompts',
    task: '13-chat-core',
    phase: '13-chat-core',
    capabilities: []
  },
  {
    id: 'MP-18',
    title: 'Chat shortcuts (message queue, hover cards, attachment context menu, image preview)',
    task: '13-chat-core',
    phase: '13-chat-core',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-27',
    capabilities: [],
    phase: '13-chat-core',
    title: 'Input interactions (newlines, topic references, slash commands, height)',
    task: '13-chat-core'
  },
  {
    id: 'MP-28',
    title: 'Message actions (copy, quote, edit and resend, regenerate, delete, read aloud)',
    task: '13-chat-core',
    phase: '13-chat-core',
    capabilities: []
  },
  {
    id: 'MP-29',
    title: 'Branch messages and copy to a new chat',
    task: '13-chat-core',
    phase: '13-chat-core',
    capabilities: []
  },
  {
    id: 'MP-30',
    title: 'Manage context (/context, /compact, /clear)',
    task: '13-chat-core',
    phase: '13-chat-core',
    capabilities: []
  },
  {
    id: 'MP-32',
    title: 'Image attachments and multimodal understanding',
    task: '13-chat-core',
    phase: '13-chat-core',
    capabilities: []
  },
  {
    id: 'MP-33',
    title: 'Drag uploads, paste long text, and handle unsupported types',
    task: '13-chat-core',
    phase: '13-chat-core',
    capabilities: []
  },
  {
    id: 'MP-34',
    title: 'Mutual exclusion of knowledge references and attachments',
    task: '13-chat-core',
    phase: '13-chat-core',
    capabilities: ['desktopAutomation']
  },
  { id: 'MP-35', title: 'Web search and URL fetching', task: '13-chat-core', phase: '13-chat-core', capabilities: [] },
  {
    id: 'MP-36',
    title: 'Reference MCP prompts and resources',
    task: '13-chat-core',
    phase: '13-chat-core',
    capabilities: []
  },
  { id: 'MP-37', title: 'Generate images in chat', task: '13-chat-core', phase: '13-chat-core', capabilities: [] },
  { id: 'MP-38', title: 'Search messages in chat', task: '13-chat-core', phase: '13-chat-core', capabilities: [] },
  {
    id: 'MP-39',
    title: 'Message token and timing details',
    task: '13-chat-core',
    phase: '13-chat-core',
    capabilities: []
  },
  {
    id: 'MP-40',
    title: 'Code block toolbar',
    task: '13-chat-core',
    phase: '13-chat-core',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-41',
    title: 'Preview HTML Artifacts',
    task: '13-chat-core',
    phase: '13-chat-core',
    capabilities: []
  },
  { id: 'MP-11', title: 'Notes and export', task: '14-notes', phase: '14-notes', capabilities: [] },
  {
    id: 'MP-74',
    title: 'Markdown editing, autosave, and conflicts',
    task: '14-notes',
    phase: '14-notes',
    capabilities: []
  },
  {
    id: 'MP-75',
    title: 'Drag to import Markdown files or folders',
    task: '14-notes',
    phase: '14-notes',
    capabilities: []
  },
  { id: 'MP-76', title: 'Search notes by name and content', task: '14-notes', phase: '14-notes', capabilities: [] },
  {
    id: 'MP-77',
    title: 'Export notes to PDF or Word and print',
    task: '14-notes',
    phase: '14-notes',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  {
    id: 'MP-78',
    title: 'Star and sort notes',
    task: '14-notes',
    phase: '14-notes',
    capabilities: []
  },
  { id: 'MP-79', title: 'Export notes to a knowledge base', task: '14-notes', phase: '14-notes', capabilities: [] },
  {
    id: 'MP-81',
    title: 'Translation history (favorite, reuse, delete, clear)',
    task: '14-translation',
    phase: '14-translation',
    capabilities: []
  },
  {
    id: 'MP-82',
    title: 'Translate files by dragging documents',
    task: '14-translation',
    phase: '14-translation',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  {
    id: 'MP-83',
    title: 'Translate images with OCR',
    task: '14-translation',
    phase: '14-translation',
    capabilities: []
  },
  {
    id: 'MP-85',
    title: 'Custom languages',
    task: '14-translation',
    phase: '14-translation',
    capabilities: []
  },
  {
    id: 'MP-86',
    title: 'Translation settings (model, auto-copy, detection method)',
    task: '14-translation',
    phase: '14-translation',
    capabilities: []
  },
  {
    id: 'MP-06',
    title: 'Change settings and preserve them after restart',
    task: '15-settings',
    phase: '15-settings',
    capabilities: []
  },
  {
    id: 'MP-104',
    capabilities: [],
    phase: '15-settings',
    title: 'Open, search, and navigate settings sections',
    task: '15-settings'
  },
  {
    id: 'MP-105',
    title: 'Theme, appearance, and window style',
    task: '15-settings',
    phase: '15-settings',
    capabilities: [],
    platforms: ['macos']
  },
  {
    id: 'MP-106',
    title: 'Fonts, font size, and zoom',
    task: '15-settings',
    phase: '15-settings',
    capabilities: []
  },
  {
    id: 'MP-107',
    title: 'Message and input settings',
    task: '15-settings',
    phase: '15-settings',
    capabilities: []
  },
  { id: 'MP-108', title: 'Assign default models', task: '15-settings', phase: '15-settings', capabilities: [] },
  {
    id: 'MP-109',
    title: 'Customize shortcuts and detect conflicts',
    task: '15-settings',
    phase: '15-settings',
    capabilities: []
  },
  {
    id: 'MP-110',
    title: 'Notification settings',
    task: '15-settings',
    phase: '15-settings',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  {
    id: 'MP-111',
    capabilities: ['desktopAutomation'],
    phase: '15-settings',
    title: 'Startup and tray behavior',
    task: '15-settings',
    platforms: ['macos']
  },
  {
    id: 'MP-112',
    title: 'Network proxy settings',
    task: '15-settings',
    phase: '15-settings',
    capabilities: ['lanInterface']
  },
  {
    id: 'MP-151',
    title: 'Channels: Feishu bot and group mentions-only toggle',
    task: '15-settings',
    phase: '15-settings',
    capabilities: []
  },
  {
    id: 'MP-113',
    title: 'Privacy settings and error reporting toggle',
    task: '15-settings',
    phase: '15-settings',
    capabilities: []
  },
  {
    id: 'MP-114',
    title: 'About page, update checks, and diagnostic export',
    task: '15-settings',
    phase: '15-settings',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-147',
    title: 'Expand long user messages by default',
    task: '15-settings',
    phase: '15-settings',
    capabilities: []
  },
  {
    id: 'MP-20',
    title: 'Create a chat from the home page and send a message',
    task: '16-assistants',
    phase: '16-assistants',
    capabilities: []
  },
  {
    id: 'MP-22',
    title: 'Edit, sort, pin, and delete assistants',
    task: '16-assistants',
    phase: '16-assistants',
    capabilities: []
  },
  {
    id: 'MP-23',
    title: 'Export and import assistants',
    task: '16-assistants',
    phase: '16-assistants',
    capabilities: ['desktopAutomation']
  },
  { id: 'MP-24', title: 'Manage assistant groups', task: '16-assistants', phase: '16-assistants', capabilities: [] },
  {
    id: 'MP-25',
    title: 'Move chats to other assistants',
    task: '16-assistants',
    phase: '16-assistants',
    capabilities: []
  },
  {
    id: 'MP-26',
    title: 'Switch models in chat',
    task: '16-assistants',
    phase: '16-assistants',
    capabilities: []
  },
  {
    id: 'MP-150',
    title: 'Preview RTF in the files page and side panel',
    task: '17-files',
    phase: '17-files',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-68',
    title: 'Upload files to the library',
    task: '17-files',
    phase: '17-files',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  { id: 'MP-69', title: 'Filter files by category and search', task: '17-files', phase: '17-files', capabilities: [] },
  {
    id: 'MP-70',
    title: 'Preview files and open their location',
    task: '17-files',
    phase: '17-files',
    capabilities: []
  },
  {
    id: 'MP-71',
    title: 'Rename, delete, and remove files',
    task: '17-files',
    phase: '17-files',
    capabilities: []
  },
  {
    id: 'MP-72',
    title: 'Reference library files in chat',
    task: '17-files',
    phase: '17-files',
    capabilities: [],
    platforms: ['macos']
  },
  {
    id: 'MP-115',
    title: 'Local backups and backup file management',
    task: '18-data',
    phase: '18-data',
    capabilities: []
  },
  {
    id: 'MP-116',
    title: 'Restore from a local backup',
    task: '18-data',
    phase: '18-data',
    capabilities: ['desktopAutomation']
  },
  { id: 'MP-117', title: 'Automatic backups and retention count', task: '18-data', phase: '18-data', capabilities: [] },
  { id: 'MP-118', title: 'Clear cache by category', task: '18-data', phase: '18-data', capabilities: [] },
  {
    id: 'MP-119',
    title: 'Migrate the application data directory',
    task: '18-data',
    phase: '18-data',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-120',
    title: 'Import ChatGPT or Claude data',
    task: '18-data',
    phase: '18-data',
    capabilities: ['desktopAutomation']
  },
  {
    id: 'MP-121',
    title: 'Reset application data (run last)',
    task: '18-data',
    phase: '18-data',
    capabilities: ['desktopAutomation'],
    platforms: ['macos']
  },
  {
    id: 'MP-122',
    title: 'Open and navigate web pages in the built-in browser',
    task: '19-browser',
    phase: '19-browser',
    capabilities: []
  },
  { id: 'MP-123', title: 'Annotate web pages', task: '19-browser', phase: '19-browser', capabilities: [] },
  {
    id: 'MP-124',
    title: 'Open chat links and tool results in the built-in browser',
    task: '19-browser',
    phase: '19-browser',
    capabilities: []
  },
  {
    id: 'MP-125',
    title: 'Page load failures and local service disconnections',
    task: '19-browser',
    phase: '19-browser',
    capabilities: []
  },
  {
    id: 'MP-127',
    capabilities: ['externalSelection', 'globalShortcut'],
    phase: '20-system',
    title: 'Selection Assistant (capture, explain, translate, copy)',
    task: '20-system',
    platforms: ['macos']
  },
  {
    id: 'MP-128',
    title: 'Screenshot tool (region, annotate, copy, OCR, add to chat)',
    task: '20-system',
    phase: '20-system',
    capabilities: ['desktopAutomation', 'screenCapture']
  },
  {
    id: 'MP-129',
    title: 'Global search across types and jump to messages',
    task: '20-system',
    phase: '20-system',
    capabilities: []
  },
  { id: 'MP-130', title: 'Pin and open launchpad items', task: '20-system', phase: '20-system', capabilities: [] },
  { id: 'MP-131', title: 'Multiple tabs and windows', task: '20-system', phase: '20-system', capabilities: [] },
  {
    id: 'MP-132',
    title: 'System tray menu',
    task: '20-system',
    phase: '20-system',
    capabilities: [],
    platforms: ['macos']
  },
  {
    id: 'MP-133',
    title: 'Deep links, single instance, and relaunch',
    task: '20-system',
    phase: '20-system',
    capabilities: [],
    platforms: ['macos']
  },
  {
    id: 'MP-140',
    title: 'Computer Use permissions and desktop control toggle',
    task: '20-system',
    phase: '20-system',
    capabilities: [],
    platforms: ['macos']
  },
  {
    id: 'MP-141',
    title: 'Device connections (phone pairing, network access)',
    task: '20-system',
    phase: '20-system',
    capabilities: []
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
