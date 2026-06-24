import type * as CherryUi from '@cherrystudio/ui'
import type { NormalToolResponse } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { parse as parsePartialJson } from 'partial-json'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentToolRenderer, isValidAgentToolsType } from '../agent'
import { AskUserQuestionOptimisticInputProvider } from '../agent/AskUserQuestionOptimisticContext'
import MessageTool from '../MessageTool'

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

vi.mock('@renderer/components/chat/messages/blocks', () => ({
  usePartsMap: () => mockPartsMap()
}))

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  useOptionalMessageListActions: () => mockMessageListActions(),
  useOptionalMessageListUi: () => ({ externalCodeEditors: [] })
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
vi.mock('@renderer/components/Icons', () => ({
  LoadingIcon: () => <span data-testid="loading-icon" />
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
    'message.tools.activity.commandName': '{{name}} command',
    'message.tools.activity.create': 'Create',
    'message.tools.activity.currentFolder': 'current folder',
    'message.tools.activity.executeCommand': 'Run command',
    'message.tools.activity.executingCommand': 'Running command',
    'message.tools.activity.file': 'file',
    'message.tools.activity.handle': 'Handle',
    'message.tools.activity.handling': 'Handling',
    'message.tools.activity.installing': 'Installing',
    'message.tools.activity.projectDependencies': 'project dependencies',
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
    'agent.askUserQuestion.title': 'Questions from Agent',
    'agent.askUserQuestion.answered': 'answered',
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

  describe('partial-json parsing', () => {
    it('should parse partial JSON correctly', () => {
      // Test partial-json library behavior
      const partialJson = '{"file_path": "/test.ts"'
      const parsed = parsePartialJson(partialJson)
      expect(parsed).toEqual({ file_path: '/test.ts' })
    })

    it('should parse nested partial JSON', () => {
      const partialJson = '{"todos": [{"content": "Task 1", "status": "pending"'
      const parsed = parsePartialJson(partialJson)
      expect(parsed).toEqual({
        todos: [{ content: 'Task 1', status: 'pending' }]
      })
    })

    it('should handle empty partial JSON', () => {
      const partialJson = '{'
      const parsed = parsePartialJson(partialJson)
      expect(parsed).toEqual({})
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

    it('should update dedicated renderer as more arguments stream in', () => {
      const initialResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'streaming',
        partialArguments: '{"file_path": "/test/partial'
      })

      const { rerender } = render(<AgentToolRenderer toolResponse={initialResponse} />)

      // Should use dedicated renderer even with partial path
      expect(screen.getByText('Viewing')).toBeInTheDocument()

      // Update with status changed to pending when arguments complete
      const updatedResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'pending',
        partialArguments: '{"file_path": "/test/complete.ts", "limit": 100}'
      })

      rerender(<AgentToolRenderer toolResponse={updatedResponse} />)

      expect(screen.getByText('Invoking')).toBeInTheDocument()
      expect(screen.queryByTestId('loading-icon')).toBeNull()
    })
  })

  describe('completed tool rendering', () => {
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

      const { container } = render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(screen.getByText('Create task')).toBeInTheDocument()
      expect(screen.getByText('Register the new SDK task tools')).toBeInTheDocument()
      expect(container.textContent).not.toContain('task-1')
      expect(screen.queryByTestId('collapse-content-TaskCreate')).toBeNull()
    })

    it('should render SDK TaskUpdate with a readable task target', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'TaskUpdate', name: 'TaskUpdate', description: 'Update task', type: 'provider' },
        status: 'done',
        arguments: {
          taskId: '1',
          status: 'in_progress'
        },
        response: 'Task updated'
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(screen.getByText('Update task')).toBeInTheDocument()
      expect(screen.getByText('Task 1')).toBeInTheDocument()
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

    it('should route Agent through the agent renderer', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'Agent', name: 'Agent', description: 'Run subagent', type: 'provider' },
        status: 'done',
        arguments: {
          description: 'Inspect renderer',
          prompt: 'Check the message renderer'
        },
        response: {
          agentId: 'agent-1',
          content: [{ type: 'text', text: 'Inspection complete' }],
          totalToolUseCount: 0,
          totalDurationMs: 1,
          totalTokens: 1,
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            server_tool_use: null,
            service_tier: null,
            cache_creation: null
          },
          status: 'completed',
          prompt: 'Check the message renderer'
        }
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(screen.getByText('Handle')).toBeInTheDocument()
      expect(screen.getByText('Inspect renderer')).toBeInTheDocument()
      expect(screen.queryByText('Inspection complete')).toBeNull()
      expect(screen.queryByTestId('collapse-content-Agent')).toBeNull()
    })

    it('should render tool with full arguments when done', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'done',
        arguments: { file_path: '/test.ts', limit: 100 },
        response: 'file content here'
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      // Should render the complete tool with output
      expect(screen.getByText('View')).toBeInTheDocument()
    })

    it('should render error state correctly', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'error',
        arguments: { file_path: '/nonexistent.ts' },
        response: 'File not found'
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      // Should still render the tool component
      expect(screen.getByText('View')).toBeInTheDocument()
      expect(screen.getByText('Error')).toHaveStyle('color: var(--color-foreground-secondary)')
      expect(
        screen.queryAllByTestId('tooltip-content').some((element) => element.textContent === 'File not found')
      ).toBe(false)
    })

    it('renders Write target paths as non-interactive intermediate output', () => {
      const openArtifactFile = vi.fn()
      mockMessageListActions.mockReturnValue({ openArtifactFile })
      const toolResponse = createToolResponse({
        tool: { id: 'Write', name: 'Write', description: 'Write a file', type: 'provider' },
        status: 'done',
        arguments: { file_path: '/tmp/game.html', content: '<html></html>' },
        response: 'File written'
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
  })

  describe('pending without streaming', () => {
    it('hides the message card while the composer handles pending permission', () => {
      const toolResponse = createToolResponse({
        status: 'pending',
        partialArguments: undefined
      })

      // Simulate an AI-SDK-v6 `approval-requested` ToolUIPart in the
      // current message's parts.
      mockPartsMap.mockReturnValue({
        msg1: [
          {
            type: 'tool-Read',
            toolCallId: toolResponse.toolCallId,
            state: 'approval-requested',
            approval: { id: 'approval-1' },
            input: toolResponse.arguments
          }
        ]
      })

      const { container } = render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(container).toBeEmptyDOMElement()
    })

    it('should show pending indicator when no streaming and no permission', () => {
      const toolResponse = createToolResponse({
        status: 'pending',
        partialArguments: undefined
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(screen.getByText('Invoking')).toBeInTheDocument()
      expect(screen.queryByTestId('loading-icon')).toBeNull()
    })

    it('hides AskUserQuestion message card while the composer handles the pending question', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'AskUserQuestion', name: 'AskUserQuestion', description: 'Ask user', type: 'provider' },
        status: 'pending',
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

      const { container } = render(<AgentToolRenderer toolResponse={toolResponse} />)

      expect(container).toBeEmptyDOMElement()
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
            state: 'approval-responded',
            approval: { id: 'approval-ask', approved: true },
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
          path: '/settings/provider',
          query: { id: 'openai' }
        },
        response: 'Navigated to /settings/provider'
      })

      render(<AgentToolRenderer toolResponse={toolResponse} />)
      fireEvent.click(screen.getByRole('button'))

      expect(navigateToRoute).toHaveBeenCalledWith({
        path: '/settings/provider',
        query: { id: 'openai' }
      })
    })
  })

  describe('meta tool rendering', () => {
    it('renders tool_search with the light tool-row styling', async () => {
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

      const { container } = render(<MessageTool toolResponse={toolResponse} />)

      const disclosure = container.querySelector('.message-tools-container')
      expect(disclosure).toHaveClass('border-none')
      expect(disclosure).toHaveClass('bg-transparent')
      expect(disclosure).not.toHaveClass('rounded-[7px]')
      expect(screen.getByTestId('wrench-icon')).toBeInTheDocument()

      const title = screen.getByText('tool_search · ns=mcp:tavily')
      expect(title).toHaveClass('font-normal')
      expect(title).toHaveClass('text-foreground-secondary')

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
      expect(screen.getByText('tool_invoke · mcp__CherryPython__pythonExecute')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button'))

      // Input params are visible flat — no second expand needed.
      expect(await screen.findByText('code')).toBeInTheDocument()
      expect(screen.getByText('print(1)')).toBeInTheDocument()
      // No nested inner tool card (its header would format the name as `Server:tool`).
      expect(screen.queryByText(/CherryPython:pythonExecute/)).toBeNull()
    })
  })

  describe('agent tool flow action', () => {
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

      fireEvent.click(screen.getByText('Handle').closest('[role="button"]')!)
      expect(openAgentToolFlow).toHaveBeenCalledWith({
        toolCallId: 'call-123',
        toolName: 'Agent',
        title: 'Inspect renderer'
      })
      expect(screen.queryByRole('button', { name: 'code_block.expand' })).toBeNull()
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

      fireEvent.click(screen.getByText('View').closest('[role="button"]')!)
      expect(openAgentToolFlow).not.toHaveBeenCalled()
      expect(screen.getByTestId('collapse-content-Bash')).toBeVisible()
      expect(screen.getByTestId('collapse-content-Bash')).toHaveClass('rounded-xl', 'bg-muted', 'px-4', 'py-3')

      fireEvent.click(screen.getByText('View').closest('[role="button"]')!)
      expect(screen.getByTestId('collapse-content-Bash')).not.toBeVisible()
      expect(screen.queryByRole('button', { name: 'button.collapse' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'code_block.expand' })).toBeNull()
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

      // Should render the DEDICATED BashTool component
      const bashLabel = screen.getByText('Installing')
      expect(bashLabel.parentElement?.parentElement).toHaveClass('text-[13px]')
      expect(bashLabel.parentElement?.parentElement).not.toHaveClass('text-sm')
      expect(bashLabel.parentElement).toHaveClass('font-normal text-foreground-secondary')
      // Command should be visible in the dedicated renderer (ANSI colorizer splits tokens across spans)
      const container = screen.getByTestId('collapse-content-Bash')
      expect(container.textContent).toContain('npm install')
    })
  })
})
