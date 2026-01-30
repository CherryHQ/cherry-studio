import type { NormalToolResponse } from '@renderer/types'
import { render, screen } from '@testing-library/react'
import { parse as parsePartialJson } from 'partial-json'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isValidAgentToolsType, MessageAgentTools } from '../MessageAgentTools'

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
const mockUseAppSelector = vi.fn()
const mockUseTranslation = vi.fn()

vi.mock('@renderer/store', () => ({
  useAppSelector: (selector: any) => mockUseAppSelector(selector)
}))

vi.mock('@renderer/store/toolPermissions', () => ({
  selectPendingPermission: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  }
}))

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

// Mock antd components
vi.mock('antd', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    Collapse: ({ items, defaultActiveKey, className }: any) => (
      <div data-testid="collapse" className={className} data-active-key={JSON.stringify(defaultActiveKey)}>
        {items?.map((item: any) => (
          <div key={item.key} data-testid={`collapse-item-${item.key}`}>
            <div data-testid={`collapse-header-${item.key}`}>{item.label}</div>
            <div data-testid={`collapse-content-${item.key}`}>{item.children}</div>
          </div>
        ))}
      </div>
    ),
    Spin: ({ size }: any) => <div data-testid="spin" data-size={size} />,
    Skeleton: {
      Input: ({ style }: any) => <span data-testid="skeleton-input" style={style} />
    },
    Tag: ({ children, className }: any) => (
      <span data-testid="tag" className={className}>
        {children}
      </span>
    ),
    Popover: ({ children }: any) => <>{children}</>,
    Card: ({ children, className }: any) => (
      <div data-testid="card" className={className}>
        {children}
      </div>
    ),
    Button: ({ children, onClick, type, size, icon, disabled }: any) => (
      <button
        type="button"
        data-testid="button"
        onClick={onClick}
        data-type={type}
        data-size={size}
        disabled={disabled}>
        {icon}
        {children}
      </button>
    )
  }
})

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

// Mock LoadingIcon
vi.mock('@renderer/components/Icons', () => ({
  LoadingIcon: () => <span data-testid="loading-icon" />
}))

// Mock ToolPermissionRequestCard
vi.mock('../ToolPermissionRequestCard', () => ({
  default: () => <div data-testid="permission-card">Permission Required</div>
}))

describe('MessageAgentTools', () => {
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
    'message.tools.labels.search': 'Search',
    'message.tools.labels.exitPlanMode': 'ExitPlanMode',
    'message.tools.labels.multiEdit': 'MultiEdit',
    'message.tools.labels.notebookEdit': 'NotebookEdit',
    'message.tools.labels.mcpServerTool': 'MCP Server Tool',
    'message.tools.labels.tool': 'Tool',
    'message.tools.sections.command': 'Command',
    'message.tools.sections.output': 'Output',
    'message.tools.sections.prompt': 'Prompt',
    'message.tools.sections.input': 'Input',
    'message.tools.status.done': 'Done',
    'message.tools.units.item': 'item',
    'message.tools.units.items': 'items',
    'message.tools.units.line': 'line',
    'message.tools.units.lines': 'lines',
    'message.tools.units.file': 'file',
    'message.tools.units.files': 'files',
    'message.tools.units.result': 'result',
    'message.tools.units.results': 'results'
  }

  beforeEach(() => {
    mockUseAppSelector.mockReturnValue(null) // No pending permission
    mockUseTranslation.mockReturnValue({
      t: (key: string, fallback?: string) => mockTranslations[key] ?? fallback ?? key
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
      expect(isValidAgentToolsType('TodoWrite')).toBe(true)
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

      render(<MessageAgentTools toolResponse={toolResponse} />)

      // Should render the DEDICATED ReadTool component, not StreamingToolContent
      // ReadTool uses 'Read File' as label, not just 'Read'
      expect(screen.getByText('Read File')).toBeInTheDocument()
      // Should show the filename from partial args
      expect(screen.getByText('test.ts')).toBeInTheDocument()
    })

    it('should pass parsed partial arguments to dedicated tool renderer', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'streaming',
        partialArguments: '{"file_path": "/path/to/myfile.ts", "offset": 10'
      })

      render(<MessageAgentTools toolResponse={toolResponse} />)

      // Should use dedicated ReadTool renderer
      expect(screen.getByText('Read File')).toBeInTheDocument()
      // Should show the filename extracted by ReadTool
      expect(screen.getByText('myfile.ts')).toBeInTheDocument()
    })

    it('should update dedicated renderer as more arguments stream in', () => {
      const initialResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'streaming',
        partialArguments: '{"file_path": "/test/partial'
      })

      const { rerender } = render(<MessageAgentTools toolResponse={initialResponse} />)

      // Should use dedicated renderer even with partial path
      expect(screen.getByText('Read File')).toBeInTheDocument()

      // Update with status changed to pending when arguments complete
      const updatedResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'pending',
        partialArguments: '{"file_path": "/test/complete.ts", "limit": 100}'
      })

      rerender(<MessageAgentTools toolResponse={updatedResponse} />)

      // When pending with no permission, shows ToolStatusIndicator with loading icon
      expect(screen.getByTestId('loading-icon')).toBeInTheDocument()
    })
  })

  describe('completed tool rendering', () => {
    it('should render tool with full arguments when done', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'done',
        arguments: { file_path: '/test.ts', limit: 100 },
        response: 'file content here'
      })

      render(<MessageAgentTools toolResponse={toolResponse} />)

      // Should render the complete tool with output
      expect(screen.getByText('Read File')).toBeInTheDocument()
    })

    it('should render error state correctly', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'Read', name: 'Read', description: 'Read a file', type: 'provider' },
        status: 'error',
        arguments: { file_path: '/nonexistent.ts' },
        response: 'File not found'
      })

      render(<MessageAgentTools toolResponse={toolResponse} />)

      // Should still render the tool component
      expect(screen.getByText('Read File')).toBeInTheDocument()
    })
  })

  describe('pending without streaming', () => {
    it('should show permission card when pending permission exists', () => {
      mockUseAppSelector.mockReturnValue({ toolCallId: 'call-123' }) // Has pending permission

      const toolResponse = createToolResponse({
        status: 'pending',
        partialArguments: undefined
      })

      render(<MessageAgentTools toolResponse={toolResponse} />)

      expect(screen.getByTestId('permission-card')).toBeInTheDocument()
    })

    it('should show pending indicator when no streaming and no permission', () => {
      const toolResponse = createToolResponse({
        status: 'pending',
        partialArguments: undefined
      })

      render(<MessageAgentTools toolResponse={toolResponse} />)

      // Should show the ToolStatusIndicator with loading icon
      expect(screen.getByTestId('loading-icon')).toBeInTheDocument()
    })
  })

  describe('TodoWrite streaming', () => {
    it('should render TodoWrite dedicated renderer with partial todos during streaming', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'TodoWrite', name: 'TodoWrite', description: 'Write todos', type: 'provider' },
        status: 'streaming',
        partialArguments:
          '{"todos": [{"content": "First task", "status": "pending", "activeForm": "Working on first task"}'
      })

      render(<MessageAgentTools toolResponse={toolResponse} />)

      // Should render the DEDICATED TodoWriteTool component, not StreamingToolContent
      // TodoWriteTool uses 'Todo Write' (with space) as label
      expect(screen.getByText('Todo Write')).toBeInTheDocument()
      // The partial todo content should be visible in the dedicated renderer
      expect(screen.getByText(/First task/)).toBeInTheDocument()
    })
  })

  describe('Bash streaming', () => {
    it('should render Bash dedicated renderer with partial command during streaming', () => {
      const toolResponse = createToolResponse({
        tool: { id: 'Bash', name: 'Bash', description: 'Execute command', type: 'provider' },
        status: 'streaming',
        partialArguments: '{"command": "npm install",'
      })

      render(<MessageAgentTools toolResponse={toolResponse} />)

      // Should render the DEDICATED BashTool component
      expect(screen.getByText('Bash')).toBeInTheDocument()
      // Command should be visible in the dedicated renderer
      expect(screen.getByText(/npm install/)).toBeInTheDocument()
    })
  })
})
