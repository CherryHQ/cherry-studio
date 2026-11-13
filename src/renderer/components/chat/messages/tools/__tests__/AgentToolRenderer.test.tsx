import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryUi from '@cherrystudio/ui'
import { PartsProvider } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'

import { ToolBlockGroup } from '../../blocks/ToolBlockGroup'
import { AgentToolRenderer, isValidAgentToolsType } from '../agent'
import { AskUserQuestionOptimisticInputProvider } from '../agent/AskUserQuestionOptimisticContext'
import MessageTool from '../MessageTool'
import MessageTools from '../MessageTools'
import { buildToolResponseFromPart, PI_AGENT_TRANSPORT } from '../toolResponse'

vi.mock('@renderer/services/AssistantService', () => ({
  getDefaultAssistant: vi.fn(() => ({
    id: 'test-assistant',
    name: 'Test Assistant',
    settings: {}
  })),
  getDefaultTopic: vi.fn(() => ({
    id: 'test-topic',
    assistantId: 'test-assistant',
    createdAt: new Date().toISOString()
  }))
}))

// Mock dependencies
const mockUseTranslation = vi.fn()

// Parts map drives approval state post-migration. Default: no pending approvals.
const mockPartsMap = vi.hoisted(() => vi.fn((): Record<string, unknown[]> | null => null))
const mockMessageListActions = vi.hoisted(() => vi.fn(() => ({})))
const mockGetToolResult = vi.hoisted(() => vi.fn())
const mockThemeState = vi.hoisted(() => ({ theme: 'light' }))

vi.mock('@renderer/components/chat/messages/blocks/MessagePartsContext', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    useScopedPartsMap: () => mockPartsMap()
  }
})

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  useOptionalMessageListActions: () => mockMessageListActions(),
  useOptionalMessageListUi: () => ({}),
  useOptionalMessageListTopicId: () => undefined
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mockGetToolResult(...args), on: () => () => {} },
  useIpcOn: () => {}
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: mockThemeState.theme })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  }
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryUi>()
  return {
    ...actual,
    Tooltip: ({ children, content }: { children: React.ReactNode; content?: React.ReactNode }) => (
      <>
        {children}
        {content ? <span data-testid="tooltip-content">{content}</span> : null}
      </>
    )
  }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

// Mock lucide-react icons
vi.mock('lucide-react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    Loader2: ({ className }: any) => <span data-testid="loader-icon" className={className} />,
    FileText: () => <span data-testid="file-icon" />,
    Terminal: () => <span data-testid="terminal-icon" />,
    ListTodo: () => <span data-testid="list-icon" />,
    Circle: () => <span data-testid="circle-icon" />,
    CheckCircle: () => <span data-testid="check-circle-icon" />,
    Clock: () => <span data-testid="clock-icon" />,
    Check: () => <span data-testid="check-icon" />,
    TriangleAlert: () => <span data-testid="triangle-alert-icon" />,
    X: () => <span data-testid="x-icon" />,
    Wrench: () => <span data-testid="wrench-icon" />,
    ImageIcon: () => <span data-testid="image-icon" />
  }
})

// Mock CodeViewer (used by ReadTool/WriteTool, depends on useSettings and useCodeStyle)
vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value }: any) => <pre data-testid="code-viewer">{value}</pre>
}))

// Mock LoadingIcon
vi.mock('@renderer/components/icons/LoadingIcon', () => ({
  default: () => <span data-testid="loading-icon" />
}))

describe('AgentToolRenderer', () => {
  // Mock translations for tools
  const mockTranslations: Record<string, string> = {
    'message.tools.labels.bash': 'Bash',
    'message.tools.labels.readFile': 'Read File',
    'message.tools.labels.todoWrite': 'Todo Write',
    'message.tools.labels.edit': 'Edit',
    'message.tools.labels.write': 'Write',
    'message.tools.labels.grep': 'Grep',
    'message.tools.labels.glob': 'Glob',
    'message.tools.labels.webSearch': 'Web Search',
    'message.tools.labels.webFetch': 'Web Fetch',
    'message.tools.labels.skill': 'Skill',
    'message.tools.labels.task': 'Task',
    'message.tools.labels.taskCreate': 'Create task',
    'message.tools.labels.taskGet': 'View task',
    'message.tools.labels.taskList': 'List tasks',
    'message.tools.labels.taskOutput': 'View task output',
    'message.tools.labels.taskStop': 'Stop task',
    'message.tools.labels.taskUpdate': 'Update task',
    'message.tools.labels.search': 'Search',
    'message.tools.labels.exitPlanMode': 'ExitPlanMode',
    'message.tools.labels.multiEdit': 'MultiEdit',
    'message.tools.labels.notebookEdit': 'NotebookEdit',
    'message.tools.labels.mcpServerTool': 'MCP Server Tool',
    'message.tools.labels.tool': 'Tool',
    'message.tools.invoking': 'Invoking',
    'message.tools.activity.assistantTask': 'task',
    'message.tools.activity.availableFeatures': 'available features',
    'message.tools.activity.availableResources': 'available resources',
    'message.tools.activity.create': 'Create',
    'message.tools.activity.currentFolder': 'current folder',
    'message.tools.activity.executeCommand': 'Run task',
    'message.tools.activity.executingCommand': 'Running task',
    'message.tools.activity.file': 'file',
    'message.tools.activity.handle': 'Handle',
    'message.tools.activity.handling': 'Handling',
    'message.tools.activity.installing': 'Installing',
    'message.tools.activity.projectDependencies': 'project requirements',
    'message.tools.activity.searching': 'Finding',
    'message.tools.activity.taskId': 'Task {{id}}',
    'message.tools.activity.taskList': 'task list',
    'message.tools.activity.view': 'View',
    'message.tools.activity.viewing': 'Viewing',
    'message.tools.error': 'Error',
    'message.tools.sections.command': 'Command',
    'message.tools.sections.output': 'Output',
    'message.tools.sections.prompt': 'Prompt',
    'message.tools.sections.input': 'Input',
    'message.tools.status.error': 'Error',
    'agent.toolPermission.decisionDenied': 'Denied',
    'agent.toolPermission.reasonLabel': 'Reason for rejection (optional)',
    'agent.askUserQuestion.title': 'Questions from Agent',
    'agent.askUserQuestion.answered': 'answered',
    'agent.builtin.cherry_support.diagnostics.prepared': 'Cherry Support prepared an editable description.',
    'agent.builtin.cherry_support.diagnostics.review': 'Review diagnostic report',
    'agent.sidebar_title': 'Agents',
    'common.create_success': 'Created successfully',
    'library.assistant_catalog.go_to_chat': 'Go to chat',
    'settings.tool.file_processing.features.document_to_markdown.title': 'Document Processing',
    'message.tools.subagent.requestedModel': 'Requested model: {{model}}',
    'message.tools.status.done': 'Done',
    'message.tools.units.item_one': '{{count}} item',
    'message.tools.units.item_other': '{{count}} items',
    'message.tools.units.line_one': '{{count}} line',
    'message.tools.units.line_other': '{{count}} lines',
    'message.tools.units.file_one': '{{count}} file',
    'message.tools.units.file_other': '{{count}} files',
    'message.tools.units.result_one': '{{count}} result',
    'message.tools.units.result_other': '{{count}} results'
  }

  beforeEach(() => {
    mockPartsMap.mockReturnValue(null) // no parts context: no pending approval
    mockMessageListActions.mockReturnValue({})
    mockThemeState.theme = 'light'
    mockUseTranslation.mockReturnValue({
      t: (key: string, options?: string | Record<string, string | number>) => {
        // Handle plural keys with count option
        if (typeof options === 'object' && options.count !== undefined) {
          const pluralKey = options.count === 1 ? `${key}_one` : `${key}_other`
          const template = mockTranslations[pluralKey] ?? mockTranslations[key] ?? key
          return template.replace('{{count}}', String(options.count))
        }
        if (typeof options === 'object') {
          const template = mockTranslations[key] ?? key
          return Object.entries(options).reduce(
            (result, [name, value]) => result.replace(`{{${name}}}`, String(value)),
            template
          )
        }
        return mockTranslations[key] ?? (typeof options === 'string' ? options : key)
      }
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // Helper to create tool response
  const createToolResponse = (overrides: Partial<NormalToolResponse> = {}): NormalToolResponse => ({
    id: 'test-tool-1',
    tool: {
      id: 'Read',
      name: 'Read',
      description: 'Read a file',
      type: 'provider'
    },
    arguments: undefined,
    status: 'pending',
    toolCallId: 'call-123',
    ...overrides
  })

  describe('isValidAgentToolsType', () => {
    it('should return true for valid tool types', () => {
      expect(isValidAgentToolsType('Read')).toBe(true)
      expect(isValidAgentToolsType('Bash')).toBe(true)
      expect(isValidAgentToolsType('Agent')).toBe(true)
      expect(isValidAgentToolsType('TaskCreate')).toBe(true)
    })

    it('should return false for invalid tool types', () => {
      expect(isValidAgentToolsType('InvalidTool')).toBe(false)
      expect(isValidAgentToolsType('')).toBe(false)
      expect(isValidAgentToolsType(null)).toBe(false)
      expect(isValidAgentToolsType(undefined)).toBe(false)
    })
  })

  describe('streaming tool rendering', () => {
    it('should render dedicated tool renderer with partial arguments during streaming', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'streaming',
        partialArguments: '{"file_path": "/test.ts"'
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      // Should render the DEDICATED ReadTool component, not StreamingToolContent
      // ReadTool uses a friendly activity label, not just the raw tool name
      expect(screen.getByText('Viewing')).toBeInTheDocument()
      // Should show the filename from partial args
      expect(screen.getByText('test.ts')).toBeInTheDocument()
    })

    it('should pass parsed partial arguments to dedicated tool renderer', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'streaming',
        partialArguments: '{"file_path": "/path/to/myfile.ts", "offset": 10'
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      // Should use dedicated ReadTool renderer
      expect(screen.getByText('Viewing')).toBeInTheDocument()
      // Should show the filename extracted by ReadTool
      expect(screen.getByText('myfile.ts')).toBeInTheDocument()
    })
  })

  describe('completed tool rendering', () => {
    it.each(['Read', 'Write', 'Edit', 'MultiEdit'])('shows the Windows filename in a completed %s card', (name) => {
      const toolResponse = createToolResponse({
        tool: { id: name, name, description: 'Access a file', type: 'provider' },
        status: 'done',
        arguments: {
          file_path: String.raw`D:\work space\qa-permission.txt`,
          content: 'written',
          old_string: 'before',
          new_string: 'after',
          edits: [{ old_string: 'before', new_string: 'after' }]
        },
        response: { content: [{ type: 'text', text: 'written' }] }
      })
      render(<AgentToolRenderer toolResponse={toolResponse} />)
      expect(screen.getByText('qa-permission.txt', { exact: true })).toBeVisible()
    })

    it('does not duplicate an ExitPlanMode plan repeated in the tool result', () => {
      const plan = '# Release plan\n\n1. Run the focused tests'
      const toolResponse = createToolResponse({
        tool: { id: 'ExitPlanMode', name: 'ExitPlanMode', description: 'Exit plan mode', type: 'provider' },
        status: 'done',
        arguments: { plan },
        response: { plan, isAgent: false }
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)
      fireEvent.click(screen.getByRole('button'))

      expect(screen.getAllByText('Release plan')).toHaveLength(1)
      expect(screen.getAllByText('Run the focused tests')).toHaveLength(1)
    })

    it('does not duplicate an ExitPlanMode plan that differs only by surrounding whitespace', () => {
      const plan = '# Release plan\n\n1. Run the focused tests'
      const toolResponse = createToolResponse({
        tool: { id: 'ExitPlanMode', name: 'ExitPlanMode', description: 'Exit plan mode', type: 'provider' },
        status: 'done',
        arguments: { plan: `${plan}   ` },
        response: { plan: `  ${plan}\n`, isAgent: false }
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)
      fireEvent.click(screen.getByRole('button'))

      expect(screen.getAllByText('Release plan')).toHaveLength(1)
      expect(screen.getAllByText('Run the focused tests')).toHaveLength(1)
    })

    it('should render newly supported structured agent tools', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'TaskCreate', name: 'TaskCreate', description: 'Create task', type: 'provider' },
        status: 'done',
        arguments: {
          subject: 'Wire tool registry',
          description: 'Register the new SDK task tools'
        },
        response: {
          task: {
            id: 'task-1',
            subject: 'Wire tool registry'
          }
        }
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(screen.getByText('Register the new SDK task tools')).toBeInTheDocument()
    })

    it('should render SDK TaskList rows with task text instead of ordinal ids', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'TaskList', name: 'TaskList', description: 'List tasks', type: 'provider' },
        status: 'done',
        arguments: {},
        response: {
          tasks: [{ id: '1', subject: 'Build launch deck', status: 'completed', blockedBy: [] }]
        }
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)
      fireEvent.click(screen.getByRole('button'))

      expect(screen.getByTestId('collapse-content-TaskList')).toHaveTextContent('Build launch deck')
      expect(screen.getByTestId('collapse-content-TaskList')).not.toHaveTextContent(/^1$/)
    })

    it('renders a dsh todo snapshot with its task states', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'TodoWrite', name: 'TodoWrite', description: 'Update todos', type: 'provider' },
        status: 'done',
        arguments: {
          todos: [
            { content: 'Inspect the bridge', status: 'completed' },
            { content: 'Wire the renderer', status: 'in_progress' }
          ]
        },
        response: [{ type: 'text', text: 'Updated todo list' }]
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)
      const trigger = screen.getByRole('button')
      expect(trigger).toHaveTextContent('Wire the renderer')
      fireEvent.click(trigger)

      const content = screen.getByTestId('collapse-content-TodoWrite')
      expect(content).toHaveTextContent('Inspect the bridge')
      expect(content).toHaveTextContent('Wire the renderer')
    })

    it('renders dsh skill names and text-block results through the Skill card', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'Skill', name: 'Skill', description: 'Load a skill', type: 'provider' },
        status: 'done',
        arguments: { name: 'design-review' },
        response: [{ type: 'text', text: 'Loaded design review instructions' }]
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)
      expect(screen.getByText('design-review')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button'))

      expect(screen.getByTestId('collapse-content-Skill')).toHaveTextContent('Loaded design review instructions')
    })

    it('shows Pi Durable read content when the file details are expanded', async () => {
      const user = userEvent.setup()
      const toolResponse = buildToolResponseFromPart({
        type: 'dynamic-tool',
        toolCallId: 'durable-read',
        toolName: 'read',
        state: 'output-available',
        input: { path: 'src/externalApp.cpp' },
        output: { content: [{ type: 'text', text: 'int result = 42;' }], isError: false },
        callProviderMetadata: { cherry: { transport: PI_AGENT_TRANSPORT } }
      })!

      render(<MessageTools toolResponse={toolResponse} />)

      expect(await screen.findByText('externalApp.cpp')).toBeVisible()
      await user.click(screen.getByRole('button', { expanded: false }))
      expect(await screen.findByText('int result = 42;')).toBeVisible()
    })

    it('shows file content from a deferred Pi Durable read result', async () => {
      mockGetToolResult.mockResolvedValue({
        found: true,
        output: { content: [{ type: 'text', text: 'lazy file content' }], isError: false }
      })
      const toolResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'done',
        arguments: { file_path: '/test.ts' },
        response: { $deferredToolResult: { topicId: 'topic-1', messageId: 'message-1', toolCallId: 'call-defer-1' } }
      })

      render(<MessageTools toolResponse={toolResponse} />)

      await waitFor(() =>
        expect(mockGetToolResult).toHaveBeenCalledWith('ai.tool.get_result', {
          topicId: 'topic-1',
          messageId: 'message-1',
          toolCallId: 'call-defer-1'
        })
      )
      fireEvent.click(await screen.findByRole('button'))
      expect(await screen.findByText('lazy file content')).toBeVisible()
    })

    it('surfaces an error when a deferred output can no longer be resolved', async () => {
      mockGetToolResult.mockResolvedValue({ found: false })
      const toolResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'done',
        arguments: { file_path: '/test.ts' },
        response: { $deferredToolResult: { topicId: 'topic-1', messageId: 'message-1', toolCallId: 'call-defer-2' } }
      })

      render(<MessageTools toolResponse={toolResponse} />)

      expect(await screen.findByText('Error')).toBeInTheDocument()
    })

    it('does not treat a small or empty output as deferred', async () => {
      const toolResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'done',
        arguments: { file_path: '/empty.ts' },
        response: ''
      })

      render(<MessageTools toolResponse={toolResponse} />)
      fireEvent.click(screen.getByRole('button'))

      expect(mockGetToolResult).not.toHaveBeenCalled()
    })

    it('shows Read error details when the tool is expanded', async () => {
      const user = userEvent.setup()
      const errorText = "ENOENT: no such file or directory, open '/nonexistent.ts'"
      const toolResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'error',
        arguments: { file_path: '/nonexistent.ts' },
        response: { isError: true, content: [{ type: 'text', text: errorText }] }
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      await user.click(screen.getByRole('button'))
      expect(await screen.findByText(errorText)).toBeVisible()
    })

    it('renders the Write target path as a clickable link once the write completes', () => {
      const openArtifactFile = vi.fn()
      mockMessageListActions.mockReturnValue({ openArtifactFile })
      const toolResponse = createToolResponse({
        tool: { id: 'Write', name: 'Write', description: 'Write a file', type: 'provider' },
        status: 'done',
        arguments: { file_path: '/tmp/game.html', content: '<html></html>' },
        response: 'File written'
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      const link = screen.getByRole('link', { name: 'game.html' })
      expect(link).toBeInTheDocument()
      fireEvent.click(link)
      expect(openArtifactFile).toHaveBeenCalledWith('/tmp/game.html')
    })

    it('keeps the Write target path non-interactive while the file is still being written', () => {
      const openArtifactFile = vi.fn()
      mockMessageListActions.mockReturnValue({ openArtifactFile })
      const toolResponse = createToolResponse({
        tool: { id: 'Write', name: 'Write', description: 'Write a file', type: 'provider' },
        status: 'streaming',
        partialArguments: '{"file_path": "/tmp/game.html", "content": "<html>'
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(screen.getByText('game.html')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'game.html' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByText('game.html'))
      expect(openArtifactFile).not.toHaveBeenCalled()
    })

    it('renders Write error details on the error status tooltip', () => {
      const errorText = "EROFS: read-only file system, open '/plane.html'"
      const toolResponse = createToolResponse({
        tool: { id: 'Write', name: 'Write', description: 'Write a file', type: 'provider' },
        status: 'error',
        arguments: { file_path: '/plane.html', content: '<html></html>' },
        response: { isError: true, content: [{ type: 'text', text: errorText }] }
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(screen.getByText('plane.html')).toBeInTheDocument()
      expect(screen.getAllByTestId('tooltip-content').some((element) => element.textContent === errorText)).toBe(true)
    })

    it('keeps the Write target path non-interactive when the write failed', () => {
      const openArtifactFile = vi.fn()
      mockMessageListActions.mockReturnValue({ openArtifactFile })
      const toolResponse = createToolResponse({
        tool: { id: 'Write', name: 'Write', description: 'Write a file', type: 'provider' },
        status: 'error',
        arguments: { file_path: '/plane.html', content: '<html></html>' },
        response: { isError: true, content: [{ type: 'text', text: 'EROFS: read-only file system' }] }
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(screen.getByText('plane.html')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'plane.html' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByText('plane.html'))
      expect(openArtifactFile).not.toHaveBeenCalled()
    })
  })

  describe('pending without streaming', () => {
    it('shows a completed AskUserQuestion message card when no answer was submitted', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'AskUserQuestion', name: 'AskUserQuestion', description: 'Ask user', type: 'provider' },
        status: 'done',
        toolCallId: 'call-ask',
        arguments: {
          questions: [
            {
              question: 'Choose logger',
              header: 'Logger',
              options: [{ label: 'Winston' }, { label: 'Pino' }],
              multiSelect: false
            }
          ]
        }
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(screen.getByText('Questions from Agent')).toBeInTheDocument()
      expect(screen.getByText('Choose logger')).toBeInTheDocument()
    })

    it('shows the denied outcome instead of an unanswered AskUserQuestion card', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'AskUserQuestion', name: 'AskUserQuestion', description: 'Ask user', type: 'provider' },
        status: 'cancelled',
        toolCallId: 'call-ask-denied',
        arguments: {
          questions: [
            {
              question: 'Choose logger',
              header: 'Logger',
              options: [{ label: 'Winston' }, { label: 'Pino' }],
              multiSelect: false
            }
          ]
        },
        approval: { approved: false, reason: 'Need more context first' }
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(screen.getByText('Denied')).toBeInTheDocument()
      expect(screen.getByText('Need more context first')).toBeInTheDocument()
      expect(screen.queryByText('Questions from Agent')).not.toBeInTheDocument()
      expect(screen.queryByText('Choose logger')).not.toBeInTheDocument()
    })

    it('shows AskUserQuestion answers from tool output when input only has questions', () => {
      const questions = [
        {
          question: 'Choose logger',
          header: 'Logger',
          options: [{ label: 'Winston' }, { label: 'Pino' }],
          multiSelect: false
        }
      ]
      const toolResponse = createToolResponse({
        tool: { id: 'AskUserQuestion', name: 'AskUserQuestion', description: 'Ask user', type: 'provider' },
        status: 'done',
        toolCallId: 'call-ask',
        arguments: { questions },
        response: {
          questions,
          answers: { 'Choose logger': 'Winston' }
        }
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(screen.getByText('Winston')).not.toBeVisible()
      fireEvent.click(screen.getAllByRole('button')[0])
      expect(screen.getByText('Winston')).toBeInTheDocument()
      expect(screen.getByText('Winston')).toBeVisible()
    })

    it('shows optimistic AskUserQuestion answers before persisted tool data arrives', () => {
      const questions = [
        {
          question: 'Choose logger',
          header: 'Logger',
          options: [{ label: 'Winston' }, { label: 'Pino' }],
          multiSelect: false
        }
      ]
      const toolResponse = createToolResponse({
        tool: { id: 'AskUserQuestion', name: 'AskUserQuestion', description: 'Ask user', type: 'provider' },
        status: 'pending',
        toolCallId: 'call-ask',
        arguments: { questions }
      })

      mockPartsMap.mockReturnValue({
        msg1: [
          {
            type: 'tool-AskUserQuestion',
            toolName: 'AskUserQuestion',
            toolCallId: toolResponse.toolCallId,
            state: 'approval-requested',
            approval: { id: 'approval-ask' },
            input: toolResponse.arguments
          }
        ]
      })

      render(
        <AskUserQuestionOptimisticInputProvider
          value={{
            'call-ask': {
              questions,
              answers: { 'Choose logger': 'Winston' }
            }
          }}>
          <AgentToolRenderer toolResponse={toolResponse} />
        </AskUserQuestionOptimisticInputProvider>
      )

      expect(screen.getByText('Questions from Agent')).toBeInTheDocument()
      expect(screen.getByText('Winston')).not.toBeVisible()
      fireEvent.click(screen.getAllByRole('button')[0])
      expect(screen.getByText('Winston')).toBeVisible()
    })

    it('renders builtin AskUserQuestion tool names through MessageTool', () => {
      const questions = [
        {
          question: 'Choose logger',
          header: 'Logger',
          options: [{ label: 'Winston' }, { label: 'Pino' }],
          multiSelect: false
        }
      ]
      const toolResponse = createToolResponse({
        tool: {
          id: 'call-ask',
          name: 'builtin_AskUserQuestion',
          description: 'Ask user',
          type: 'builtin'
        },
        status: 'done',
        toolCallId: 'call-ask',
        arguments: { questions, answers: { 'Choose logger': 'Winston' } }
      })

      render(<MessageTool toolResponse={toolResponse} />)

      expect(screen.getByText('Questions from Agent')).toBeInTheDocument()
      fireEvent.click(screen.getAllByRole('button')[0])
      expect(screen.getByText('Winston')).toBeVisible()
    })
  })

  it('keeps a denied tool decision and its reason visible in history', () => {
    const toolResponse = createToolResponse({
      status: 'cancelled',
      arguments: { command: 'rm -rf build' },
      approval: { approved: false, reason: 'use a copy instead' }
    })

    render(<AgentToolRenderer toolResponse={toolResponse} />)

    expect(screen.getByText('Denied')).toBeInTheDocument()
    expect(screen.getByText('use a copy instead')).toBeInTheDocument()
  })

  describe('assistant create_agent tool rendering', () => {
    it('opens the newly created Agent conversation from the success action', async () => {
      const user = userEvent.setup()
      const navigateToRoute = vi.fn()
      mockMessageListActions.mockReturnValue({ navigateToRoute })
      const result = {
        ok: true,
        agentId: 'agent-created',
        name: 'Reviewer',
        model: 'anthropic::claude-sonnet'
      }
      const toolResponse: McpToolResponse = {
        id: 'call-create-agent',
        tool: {
          id: 'assistant__mcp__assistant__create_agent',
          name: 'create_agent',
          description: 'Create Agent',
          type: 'mcp',
          serverId: 'assistant',
          serverName: 'assistant',
          inputSchema: { type: 'object', properties: {}, required: [] }
        },
        arguments: undefined,
        status: 'done',
        response: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result
        },
        toolCallId: 'call-create-agent'
      }

      render(<MessageTools toolResponse={toolResponse} />)

      await user.click(screen.getByRole('button', { name: 'Go to chat: Reviewer' }))
      expect(navigateToRoute).toHaveBeenCalledWith({
        path: '/app/agents',
        query: { agentId: 'agent-created' }
      })
    })
  })

  describe('assistant prepare_diagnostic_report tool rendering', () => {
    const preparedResponse: McpToolResponse = {
      id: 'call-prepare-report',
      tool: {
        id: 'assistant__mcp__assistant__prepare_diagnostic_report',
        name: 'prepare_diagnostic_report',
        description: 'Prepare diagnostic report',
        type: 'mcp',
        serverId: 'assistant',
        serverName: 'assistant',
        inputSchema: { type: 'object', properties: {}, required: [] }
      },
      arguments: undefined,
      status: 'done',
      response: {
        content: [{ type: 'text', text: 'Diagnostic report draft prepared.' }],
        structuredContent: { ok: true, description: 'Draft from this tool call' }
      },
      toolCallId: 'call-prepare-report'
    }

    it('opens the report launcher with this tool call draft', async () => {
      const user = userEvent.setup()
      const openReport = vi.fn()
      const navigateToRoute = vi.fn()
      mockMessageListActions.mockReturnValue({ navigateToRoute, openDiagnosticReport: openReport })

      render(<MessageTools toolResponse={preparedResponse} />)

      expect(screen.getByText('Cherry Support prepared an editable description.')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Review diagnostic report' }))
      expect(openReport).toHaveBeenCalledWith('Draft from this tool call')
      expect(navigateToRoute).not.toHaveBeenCalled()
      expect(mockGetToolResult).not.toHaveBeenCalled()
    })

    it('shows the prepared state without a dead action when no launcher is available', () => {
      render(<MessageTools toolResponse={preparedResponse} />)

      expect(screen.getByText('Cherry Support prepared an editable description.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Review diagnostic report' })).not.toBeInTheDocument()
    })
  })

  describe('navigate tool rendering', () => {
    it('routes navigate tool clicks through message list action', () => {
      const navigateToRoute = vi.fn()
      mockMessageListActions.mockReturnValue({ navigateToRoute })
      const toolResponse = createToolResponse({
        tool: {
          id: 'mcp__assistant__navigate',
          name: 'mcp__assistant__navigate',
          description: 'Navigate',
          type: 'provider'
        },
        status: 'done',
        arguments: {
          path: '/app/agents',
          query: { sessionId: 'session-1' }
        },
        response: 'Navigate link created: /app/agents'
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(screen.getByText(/Agents/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button'))

      expect(navigateToRoute).toHaveBeenCalledWith({
        path: '/app/agents',
        query: { sessionId: 'session-1' }
      })
    })
  })

  describe('meta tool rendering', () => {
    it('renders and expands tool_search results', async () => {
      const toolResponse = createToolResponse({
        id: 'meta-tool-search',
        tool: {
          id: 'tool_search',
          name: 'tool_search',
          description: 'Search deferred tools',
          type: 'provider'
        },
        status: 'done',
        arguments: { namespace: 'mcp:tavily' },
        response: {
          matchedNamespaces: [
            {
              namespace: 'mcp:tavily',
              tools: [{ name: 'tavily_search' }]
            }
          ]
        }
      })

      render(<MessageTool toolResponse={toolResponse} />)

      fireEvent.click(screen.getByRole('button'))
      expect(await screen.findByText('tavily_search')).toBeInTheDocument()
    })

    it('shows tool_invoke input params flat without nesting a second tool card', async () => {
      const toolResponse = createToolResponse({
        id: 'meta-tool-invoke',
        tool: { id: 'tool_invoke', name: 'tool_invoke', description: 'Invoke a tool', type: 'provider' },
        status: 'error',
        arguments: { name: 'mcp__CherryPython__pythonExecute', params: { code: 'print(1)' } },
        response: { isError: true, content: [{ type: 'text', text: 'boom' }] }
      })

      render(<MessageTool toolResponse={toolResponse} />)

      // Outer header names the inner tool (raw mcp__ form).

      fireEvent.click(screen.getByRole('button'))

      // Input params are visible flat — no second expand needed.
      expect(await screen.findByText('code')).toBeInTheDocument()
      expect(screen.getByText('print(1)')).toBeInTheDocument()
      // No nested inner tool card (its header would format the name as `Server:tool`).
    })
  })

  describe('agent tool flow action', () => {
    it.each(['Task', 'Agent'])(
      'shows the requested model and routes a nested %s click through the renderer chain',
      async (toolName) => {
        const openAgentToolFlow = vi.fn()
        mockMessageListActions.mockReturnValue({ openAgentToolFlow })
        const toolResponse = createToolResponse({
          tool: { id: toolName, name: toolName, description: 'Run subagent', type: 'provider' },
          status: 'done',
          arguments: {
            description: 'Inspect renderer',
            prompt: 'Check the message renderer',
            model: '  OpenRouter Claude Sonnet 4.5  '
          },
          response: 'ok'
        })

        render(<ToolBlockGroup items={[{ id: 'agent-group', toolResponse }]} />)

        const groupTrigger = screen.getByTestId('child-tool-group').querySelector('button')!
        fireEvent.click(groupTrigger)

        const row = screen.getByRole('button', { name: /Inspect renderer/, pressed: false })
        expect(within(row).getByText('Requested model: OpenRouter Claude Sonnet 4.5')).toBeVisible()
        await userEvent.setup().click(row)

        expect(openAgentToolFlow).toHaveBeenCalledWith({
          toolCallId: 'call-123',
          toolName,
          title: 'Inspect renderer'
        })
      }
    )

    it('shows child progress after its launch tool returns and opens the same right-pane flow', async () => {
      const openAgentToolFlow = vi.fn()
      mockMessageListActions.mockReturnValue({ openAgentToolFlow })
      const response = createToolResponse({
        tool: { id: 'Agent', name: 'Agent', description: 'Run subagent', type: 'provider' },
        status: 'done',
        arguments: { description: 'Inspect renderer', model: 'Anthropic Claude Sonnet 4.5' },
        response: { status: 'async_launched', taskId: 'child' }
      })
      const started = {
        type: 'data-agent-task-event',
        data: { event: 'started', taskId: 'child', toolUseId: 'call-123', status: 'in_progress' }
      } as CherryMessagePart
      const completed = {
        type: 'data-agent-task-event',
        data: { event: 'notification', taskId: 'child', status: 'completed' }
      } as CherryMessagePart
      const withParts = (parts: CherryMessagePart[]) => (
        <PartsProvider value={{ reply: parts }}>
          <AgentToolRenderer toolResponse={response} />
        </PartsProvider>
      )
      const { rerender } = render(withParts([started]))
      expect(screen.getByText('message.tools.status.running')).toBeVisible()
      expect(
        within(screen.getByRole('button', { name: /Inspect renderer/ })).getByText(
          'Requested model: Anthropic Claude Sonnet 4.5'
        )
      ).toBeVisible()
      await userEvent.setup().click(screen.getByRole('button', { name: /Inspect renderer/ }))
      expect(openAgentToolFlow).toHaveBeenCalledWith({
        toolCallId: 'call-123',
        toolName: 'Agent',
        title: 'Inspect renderer'
      })
      rerender(withParts([started, completed]))
      expect(screen.getByText('common.completed')).toBeVisible()
      expect(
        within(screen.getByRole('button', { name: /Inspect renderer/ })).getByText(
          'Requested model: Anthropic Claude Sonnet 4.5'
        )
      ).toBeVisible()
      expect(screen.queryByText('message.tools.status.running')).toBeNull()
      mockMessageListActions.mockReturnValue({
        openAgentToolFlow,
        isAgentToolFlowActive: (id: string) => id === 'call-123'
      })
      rerender(withParts([started, completed]))
      expect(screen.getByRole('button', { name: /Inspect renderer/ })).toHaveAttribute('aria-pressed', 'true')
      mockMessageListActions.mockReturnValue({ openAgentToolFlow, isAgentToolFlowActive: () => false })
      rerender(withParts([started, completed]))
      expect(screen.getByRole('button', { name: /Inspect renderer/ })).toHaveAttribute('aria-pressed', 'false')
    })

    it('keeps concurrent calls bound to their own requested model and tool call', async () => {
      const openAgentToolFlow = vi.fn()
      mockMessageListActions.mockReturnValue({ openAgentToolFlow })
      const calls = [
        { id: 'first', title: 'Inspect main', model: 'OpenRouter Claude Sonnet 4.5' },
        { id: 'second', title: 'Inspect renderer', model: 'Anthropic Claude Sonnet 4.5' }
      ]
      render(
        <>
          {calls.map(({ id, title, model }) => (
            <AgentToolRenderer
              key={id}
              toolResponse={createToolResponse({
                id,
                toolCallId: id,
                tool: { id: 'Agent', name: 'Agent', description: 'Run subagent', type: 'provider' },
                status: 'invoking',
                arguments: { description: title, model }
              })}
            />
          ))}
        </>
      )
      const user = userEvent.setup()
      for (const { id, title, model } of calls) {
        const row = screen.getByRole('button', { name: new RegExp(title) })
        expect(within(row).getByText(`Requested model: ${model}`)).toBeVisible()
        expect(within(row).queryByText(`Requested model: ${calls.find((call) => call.id !== id)!.model}`)).toBeNull()
        await user.click(row)
        expect(openAgentToolFlow).toHaveBeenLastCalledWith({ toolCallId: id, toolName: 'Agent', title })
      }
    })

    it.each(['error', 'cancelled'] as const)('keeps the full requested model on a %s row', (status) => {
      mockMessageListActions.mockReturnValue({ openAgentToolFlow: vi.fn() })
      const model =
        'OpenRouter Claude Sonnet 4.5 with a very long caller supplied model name that must remain fully readable'
      render(
        <AgentToolRenderer
          toolResponse={createToolResponse({
            tool: { id: 'Agent', name: 'Agent', description: 'Run subagent', type: 'provider' },
            status,
            arguments: { description: 'Inspect renderer', model },
            response:
              status === 'error' ? { isError: true, content: [{ type: 'text', text: 'Unknown model' }] } : undefined
          })}
        />
      )
      const row = screen.getByRole('button', { name: /Inspect renderer/ })
      expect(within(row).getByText(`Requested model: ${model}`)).toBeVisible()
      expect(
        within(row).getByText(status === 'error' ? 'message.tools.status.failed' : 'message.tools.cancelled')
      ).toBeVisible()
    })

    it.each([
      { description: 'Inspect renderer' },
      { description: 'Inspect renderer', model: '' },
      { description: 'Inspect renderer', model: '   ' },
      { description: 'Inspect renderer', model: 42 },
      { description: 'Inspect renderer', model: null },
      { description: 'Inspect renderer', model: ['Claude Sonnet 4.5'] }
    ])('omits the requested model for invalid or missing model input: %j', (arguments_) => {
      mockMessageListActions.mockReturnValue({ openAgentToolFlow: vi.fn() })
      render(
        <AgentToolRenderer
          toolResponse={createToolResponse({
            tool: { id: 'Agent', name: 'Agent', description: 'Run subagent', type: 'provider' },
            status: 'done',
            arguments: arguments_
          })}
        />
      )
      expect(
        within(screen.getByRole('button', { name: /Inspect renderer/ })).queryByText(/Requested model:/)
      ).toBeNull()
    })

    it('opens the right-pane flow only from subagent rows', () => {
      const openAgentToolFlow = vi.fn()
      mockMessageListActions.mockReturnValue({ openAgentToolFlow })
      const toolResponse = createToolResponse({
        tool: { id: 'Agent', name: 'Agent', description: 'Run subagent', type: 'provider' },
        status: 'done',
        arguments: { description: 'Inspect renderer', prompt: 'Check the message renderer' },
        response: 'ok'
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      fireEvent.click(screen.getByRole('button', { name: /Inspect renderer/ }))
      expect(openAgentToolFlow).toHaveBeenCalledWith({
        toolCallId: 'call-123',
        toolName: 'Agent',
        title: 'Inspect renderer'
      })
    })

    it('keeps ordinary tool row clicks local even when the flow action exists', () => {
      const openAgentToolFlow = vi.fn()
      mockMessageListActions.mockReturnValue({ openAgentToolFlow })
      const toolResponse = createToolResponse({
        tool: { id: 'Bash', name: 'Bash', description: 'Execute command', type: 'provider' },
        status: 'done',
        arguments: { command: 'pwd' },
        response: 'ok'
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      const toolHeader = screen.getByText('View').closest('[role="button"]')!

      fireEvent.click(toolHeader)
      expect(openAgentToolFlow).not.toHaveBeenCalled()
      expect(screen.getByTestId('collapse-content-Bash')).toBeVisible()

      fireEvent.click(toolHeader)
      expect(screen.getByTestId('collapse-content-Bash')).not.toBeVisible()
    })
  })

  describe('Bash result presentation', () => {
    it('labels successful Bash results as output', async () => {
      const user = userEvent.setup()
      const toolResponse = createToolResponse({
        tool: { id: 'Bash', name: 'Bash', description: 'Execute command', type: 'provider' },
        status: 'done',
        arguments: { command: 'pwd' },
        response: '/workspace'
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)
      await user.click(screen.getByRole('button'))

      const content = screen.getByTestId('collapse-content-Bash')
      expect(content).toHaveTextContent('Output')
      expect(content).toHaveTextContent('/workspace')
    })

    it('labels failed Bash execution details as an error instead of command output', async () => {
      const user = userEvent.setup()
      const errorText =
        'sandbox escalation to "danger-full-access" is not strictly wider than this call\'s current "danger-full-access" mode'
      const toolResponse = createToolResponse({
        tool: { id: 'Bash', name: 'Bash', description: 'Execute command', type: 'provider' },
        status: 'error',
        arguments: { command: 'pwd' },
        response: { isError: true, content: [{ type: 'text', text: errorText }] }
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)
      await user.click(screen.getByRole('button'))

      const content = screen.getByTestId('collapse-content-Bash')
      expect(content).toHaveTextContent('Error')
      expect(content).toHaveTextContent(errorText)
      expect(content).not.toHaveTextContent('Output')
    })
  })

  describe('Bash streaming', () => {
    it('should render Bash dedicated renderer with partial command during streaming', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'Bash', name: 'Bash', description: 'Execute command', type: 'provider' },
        status: 'streaming',
        partialArguments: '{"command": "npm install",'
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(screen.getByText('Installing')).toBeInTheDocument()
      // Command should be visible in the dedicated renderer (ANSI colorizer splits tokens across spans)
      const container = screen.getByTestId('collapse-content-Bash')
      expect(container.textContent).toContain('npm install')
    })
  })
})
