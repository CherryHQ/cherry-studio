import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Agent, AgentStatus } from '@renderer/types/agent'
import AgentHubPage from '../AgentHubPage'

// Access the global mock API
const mockApi = (global as any).api

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' }
  })
}))


describe('AgentHubPage', () => {
  const mockAgents: Agent[] = [
    {
      id: 'agent-1',
      name: 'Test Agent',
      description: 'A test agent',
      system_prompt: 'You are a helpful assistant',
      model: 'gpt-4',
      tools: [],
      knowledges: [],
      status: AgentStatus.IDLE,
      created_at: new Date(),
      updated_at: new Date()
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.agent.list.mockResolvedValue(mockAgents)
  })

  describe('Layout Structure', () => {
    it('should render with two-column layout', async () => {
      render(<AgentHubPage />)
      
      // Check for main container
      const container = screen.getByTestId('agent-hub-container')
      expect(container).toBeInTheDocument()
      
      // Check for left column (agent list)
      const leftColumn = screen.getByTestId('agent-list-column')
      expect(leftColumn).toBeInTheDocument()
      
      // Check for right column (details)
      const rightColumn = screen.getByTestId('agent-details-column')
      expect(rightColumn).toBeInTheDocument()
    })

    it('should have proper CSS classes for two-column layout', async () => {
      render(<AgentHubPage />)
      
      const container = screen.getByTestId('agent-hub-container')
      expect(container).toHaveClass('agent-hub-layout')
      
      const leftColumn = screen.getByTestId('agent-list-column')
      expect(leftColumn).toHaveClass('agent-list-column')
      
      const rightColumn = screen.getByTestId('agent-details-column')
      expect(rightColumn).toHaveClass('agent-details-column')
    })

    it('should load agent list within 1 second', async () => {
      const startTime = Date.now()
      
      render(<AgentHubPage />)
      
      await waitFor(() => {
        expect(mockApi.agent.list).toHaveBeenCalled()
      })
      
      const endTime = Date.now()
      const loadTime = endTime - startTime
      
      expect(loadTime).toBeLessThan(1000) // 1 second requirement
    })
  })

  describe('Empty State', () => {
    beforeEach(() => {
      mockApi.agent.list.mockResolvedValue([])
    })

    it('should show empty state when no agents exist', async () => {
      render(<AgentHubPage />)
      
      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument()
      })
      
      expect(screen.getByText('agent_hub.empty.title')).toBeInTheDocument()
      expect(screen.getByText('agent_hub.empty.description')).toBeInTheDocument()
    })

    it('should show create button in empty state', async () => {
      render(<AgentHubPage />)
      
      await waitFor(() => {
        const createButton = screen.getByTestId('empty-create-button')
        expect(createButton).toBeInTheDocument()
        expect(createButton).toHaveTextContent('agent_hub.button.create')
      })
    })

    it('should handle create button click in empty state', async () => {
      render(<AgentHubPage />)
      
      await waitFor(() => {
        const createButton = screen.getByTestId('empty-create-button')
        fireEvent.click(createButton)
        
        // Should navigate to agent configuration
        expect(screen.getByTestId('agent-config-view')).toBeInTheDocument()
      })
    })
  })

  describe('Navigation', () => {
    it('should provide navigation to agent configuration view', async () => {
      render(<AgentHubPage />)
      
      const configButton = screen.getByTestId('nav-config-button')
      expect(configButton).toBeInTheDocument()
      
      fireEvent.click(configButton)
      expect(screen.getByTestId('agent-config-view')).toBeInTheDocument()
    })

    it('should provide navigation to agent execution view', async () => {
      render(<AgentHubPage />)
      
      const executionButton = screen.getByTestId('nav-execution-button')
      expect(executionButton).toBeInTheDocument()
      
      fireEvent.click(executionButton)
      expect(screen.getByTestId('agent-execution-view')).toBeInTheDocument()
    })

    it('should have proper navigation button labels', async () => {
      render(<AgentHubPage />)
      
      expect(screen.getByText('agent_hub.nav.configuration')).toBeInTheDocument()
      expect(screen.getByText('agent_hub.nav.execution')).toBeInTheDocument()
    })
  })

  describe('Performance Requirements', () => {
    const generateMockAgents = (count: number): Agent[] => {
      return Array.from({ length: count }, (_, index) => ({
        id: `agent-${index}`,
        name: `Agent ${index}`,
        description: `Description for agent ${index}`,
        system_prompt: 'You are a helpful assistant',
        model: 'gpt-4',
        tools: [],
        knowledges: [],
        status: AgentStatus.IDLE,
        created_at: new Date(),
        updated_at: new Date()
      }))
    }

    it('should handle 100 agents efficiently', async () => {
      const manyAgents = generateMockAgents(100)
      mockApi.agent.list.mockResolvedValue(manyAgents)
      
      const startTime = Date.now()
      render(<AgentHubPage />)
      
      await waitFor(() => {
        expect(screen.getByTestId('agent-list')).toBeInTheDocument()
      })
      
      const endTime = Date.now()
      const renderTime = endTime - startTime
      
      expect(renderTime).toBeLessThan(1000) // Should render within 1 second
      expect(screen.getByText('100')).toBeInTheDocument() // Agent count display
    })
  })

  describe('Accessibility', () => {
    it('should have proper ARIA labels', async () => {
      render(<AgentHubPage />)
      
      expect(screen.getByRole('main')).toHaveAttribute('aria-label', 'agent_hub.aria.main')
      expect(screen.getByRole('complementary')).toHaveAttribute('aria-label', 'agent_hub.aria.sidebar')
    })

    it('should support keyboard navigation', async () => {
      render(<AgentHubPage />)
      
      const configButton = screen.getByTestId('nav-config-button')
      
      // Tab to focus
      configButton.focus()
      expect(configButton).toHaveFocus()
      
      // Enter to activate
      fireEvent.keyDown(configButton, { key: 'Enter' })
      expect(screen.getByTestId('agent-config-view')).toBeInTheDocument()
    })
  })
})