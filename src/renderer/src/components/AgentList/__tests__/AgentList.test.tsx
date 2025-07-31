import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Agent, AgentStatus } from '@renderer/types/agent'
import AgentList from '../AgentList'

// Access the global mock API
const mockApi = (global as any).api

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' }
  })
}))


describe('AgentList', () => {
  const mockAgents: Agent[] = [
    {
      id: 'agent-1',
      name: 'Test Agent 1',
      description: 'First test agent',
      system_prompt: 'You are a helpful assistant',
      model: 'gpt-4',
      tools: [],
      knowledges: [],
      status: AgentStatus.IDLE,
      created_at: new Date('2024-01-01'),
      updated_at: new Date('2024-01-01')
    },
    {
      id: 'agent-2',
      name: 'Test Agent 2',
      description: 'Second test agent',
      system_prompt: 'You are a helpful assistant',
      model: 'claude-3-sonnet',
      tools: [],
      knowledges: [],
      status: AgentStatus.RUNNING,
      created_at: new Date('2024-01-02'),
      updated_at: new Date('2024-01-02')
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.agent.list.mockResolvedValue(mockAgents)
  })

  describe('Rendering', () => {
    it('should render agent list container', async () => {
      render(<AgentList />)
      
      await waitFor(() => {
        const listContainer = screen.getByTestId('agent-list')
        expect(listContainer).toBeInTheDocument()
        expect(listContainer).toHaveClass('agent-list-container')
      })
    })

    it('should display agents when data is loaded', async () => {
      render(<AgentList />)
      
      await waitFor(() => {
        expect(screen.getByText('Test Agent 1')).toBeInTheDocument()
        expect(screen.getByText('Test Agent 2')).toBeInTheDocument()
      })
      
      expect(screen.getByText('First test agent')).toBeInTheDocument()
      expect(screen.getByText('Second test agent')).toBeInTheDocument()
    })

    it('should show agent status indicators', async () => {
      render(<AgentList />)
      
      await waitFor(() => {
        const idleStatus = screen.getByTestId('agent-status-idle')
        const runningStatus = screen.getByTestId('agent-status-running')
        
        expect(idleStatus).toBeInTheDocument()
        expect(runningStatus).toBeInTheDocument()
      })
    })
  })

  describe('Empty State', () => {
    beforeEach(() => {
      mockApi.agent.list.mockResolvedValue([])
    })

    it('should show empty state when no agents exist', async () => {
      render(<AgentList />)
      
      await waitFor(() => {
        expect(screen.getByTestId('agent-list-empty')).toBeInTheDocument()
      })
      
      expect(screen.getByText('agent_list.empty.title')).toBeInTheDocument()
      expect(screen.getByText('agent_list.empty.description')).toBeInTheDocument()
    })

    it('should show create button in empty state', async () => {
      render(<AgentList />)
      
      await waitFor(() => {
        const createButton = screen.getByTestId('agent-list-create-button')
        expect(createButton).toBeInTheDocument()
        expect(createButton).toHaveTextContent('agent_list.button.create_first')
      })
    })

    it('should have proper empty state styling', async () => {
      render(<AgentList />)
      
      await waitFor(() => {
        const emptyState = screen.getByTestId('agent-list-empty')
        expect(emptyState).toHaveClass('empty-state')
      })
    })
  })

  describe('Loading State', () => {
    it('should show loading indicator while fetching agents', async () => {
      // Mock a delayed response
      mockApi.agent.list.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve(mockAgents), 100))
      )
      
      render(<AgentList />)
      
      expect(screen.getByTestId('agent-list-loading')).toBeInTheDocument()
      expect(screen.getByText('agent_list.loading')).toBeInTheDocument()
      
      await waitFor(() => {
        expect(screen.queryByTestId('agent-list-loading')).not.toBeInTheDocument()
      })
    })
  })

  describe('Agent Selection', () => {
    it('should handle agent selection', async () => {
      const onAgentSelect = vi.fn()
      render(<AgentList onAgentSelect={onAgentSelect} />)
      
      await waitFor(() => {
        const firstAgent = screen.getByTestId('agent-item-agent-1')
        fireEvent.click(firstAgent)
        
        expect(onAgentSelect).toHaveBeenCalledWith(mockAgents[0])
      })
    })

    it('should highlight selected agent', async () => {
      render(<AgentList selectedAgentId="agent-1" />)
      
      await waitFor(() => {
        const selectedAgent = screen.getByTestId('agent-item-agent-1')
        expect(selectedAgent).toHaveClass('selected')
      })
    })

    it('should remove selection when clicking selected agent', async () => {
      const onAgentSelect = vi.fn()
      render(<AgentList selectedAgentId="agent-1" onAgentSelect={onAgentSelect} />)
      
      await waitFor(() => {
        const selectedAgent = screen.getByTestId('agent-item-agent-1')
        fireEvent.click(selectedAgent)
        
        expect(onAgentSelect).toHaveBeenCalledWith(null)
      })
    })
  })

  describe('Agent Actions', () => {
    it('should show context menu on right click', async () => {
      render(<AgentList />)
      
      await waitFor(() => {
        const firstAgent = screen.getByTestId('agent-item-agent-1')
        fireEvent.contextMenu(firstAgent)
        
        expect(screen.getByTestId('agent-context-menu')).toBeInTheDocument()
      })
    })

    it('should provide edit option in context menu', async () => {
      render(<AgentList />)
      
      await waitFor(() => {
        const firstAgent = screen.getByTestId('agent-item-agent-1')
        fireEvent.contextMenu(firstAgent)
        
        const editOption = screen.getByTestId('context-menu-edit')
        expect(editOption).toBeInTheDocument()
        expect(editOption).toHaveTextContent('agent_list.action.edit')
      })
    })

    it('should provide delete option in context menu', async () => {
      render(<AgentList />)
      
      await waitFor(() => {
        const firstAgent = screen.getByTestId('agent-item-agent-1')
        fireEvent.contextMenu(firstAgent)
        
        const deleteOption = screen.getByTestId('context-menu-delete')
        expect(deleteOption).toBeInTheDocument()
        expect(deleteOption).toHaveTextContent('agent_list.action.delete')
      })
    })
  })

  describe('Performance', () => {
    it('should virtualize large lists', async () => {
      const manyAgents = Array.from({ length: 100 }, (_, index) => ({
        id: `agent-${index}`,
        name: `Agent ${index}`,
        description: `Description ${index}`,
        system_prompt: 'You are a helper',
        model: 'gpt-4',
        tools: [],
        knowledges: [],
        status: AgentStatus.IDLE,
        created_at: new Date(),
        updated_at: new Date()
      }))
      
      mockApi.agent.list.mockResolvedValue(manyAgents)
      
      render(<AgentList />)
      
      await waitFor(() => {
        const listContainer = screen.getByTestId('agent-list')
        expect(listContainer).toHaveAttribute('data-virtualized', 'true')
      })
    })

    it('should load agents within performance threshold', async () => {
      const startTime = Date.now()
      
      render(<AgentList />)
      
      await waitFor(() => {
        expect(screen.getByTestId('agent-list')).toBeInTheDocument()
      })
      
      const endTime = Date.now()
      const loadTime = endTime - startTime
      
      expect(loadTime).toBeLessThan(1000) // 1 second requirement
    })
  })

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', async () => {
      render(<AgentList />)
      
      await waitFor(() => {
        const listContainer = screen.getByTestId('agent-list')
        expect(listContainer).toHaveAttribute('role', 'list')
        expect(listContainer).toHaveAttribute('aria-label', 'agent_list.aria.agents')
      })
    })

    it('should support keyboard navigation', async () => {
      render(<AgentList />)
      
      await waitFor(() => {
        const firstAgent = screen.getByTestId('agent-item-agent-1')
        
        firstAgent.focus()
        expect(firstAgent).toHaveFocus()
        
        // Arrow down should move to next agent
        fireEvent.keyDown(firstAgent, { key: 'ArrowDown' })
        
        const secondAgent = screen.getByTestId('agent-item-agent-2')
        expect(secondAgent).toHaveFocus()
      })
    })

    it('should support Enter key for selection', async () => {
      const onAgentSelect = vi.fn()
      render(<AgentList onAgentSelect={onAgentSelect} />)
      
      await waitFor(() => {
        const firstAgent = screen.getByTestId('agent-item-agent-1')
        
        firstAgent.focus()
        fireEvent.keyDown(firstAgent, { key: 'Enter' })
        
        expect(onAgentSelect).toHaveBeenCalledWith(mockAgents[0])
      })
    })
  })
})