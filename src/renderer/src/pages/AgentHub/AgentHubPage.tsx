import { Button } from 'antd'
import { FC, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Agent } from '@renderer/types/agent'
import AgentList from '@renderer/components/AgentList/AgentList'
import '../../styles/agentHub.css'

// Mock view states for navigation
type ViewState = 'hub' | 'config' | 'execution'

const AgentHubPage: FC = () => {
  const { t } = useTranslation()
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [currentView, setCurrentView] = useState<ViewState>('hub')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadAgents = async () => {
      try {
        setLoading(true)
        const agentList = await window.api.agent.list()
        setAgents(agentList)
      } catch (error) {
        console.error('Failed to load agents:', error)
        setAgents([])
      } finally {
        setLoading(false)
      }
    }

    loadAgents()
  }, [])

  const handleCreateAgent = () => {
    setCurrentView('config')
  }

  const handleNavToConfig = () => {
    setCurrentView('config')
  }

  const handleNavToExecution = () => {
    setCurrentView('execution')
  }

  const handleAgentSelect = (agent: Agent | null) => {
    setSelectedAgent(agent)
  }

  // Show different views based on navigation
  if (currentView === 'config') {
    return (
      <div data-testid="agent-config-view" style={{ padding: '20px', height: '100vh', backgroundColor: 'var(--color-background)' }}>
        <h2>{t('agent_hub.config.title')}</h2>
        <Button onClick={() => setCurrentView('hub')}>
          {t('agent_hub.nav.back_to_hub')}
        </Button>
      </div>
    )
  }

  if (currentView === 'execution') {
    return (
      <div data-testid="agent-execution-view" style={{ padding: '20px', height: '100vh', backgroundColor: 'var(--color-background)' }}>
        <h2>{t('agent_hub.execution.title')}</h2>
        <Button onClick={() => setCurrentView('hub')}>
          {t('agent_hub.nav.back_to_hub')}
        </Button>
      </div>
    )
  }

  return (
    <div data-testid="agent-hub-container" className="agent-hub-layout">
      <div data-testid="agent-list-column" className="agent-list-column">
        <div className="agent-hub-nav">
          <button 
            data-testid="nav-config-button"
            onClick={handleNavToConfig}
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleNavToConfig()}
          >
            {t('agent_hub.nav.configuration')}
          </button>
          <button 
            data-testid="nav-execution-button"
            onClick={handleNavToExecution}
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleNavToExecution()}
          >
            {t('agent_hub.nav.execution')}
          </button>
        </div>

        {agents.length === 0 && !loading ? (
          <div data-testid="empty-state" className="empty-state">
            <h3>{t('agent_hub.empty.title')}</h3>
            <p>{t('agent_hub.empty.description')}</p>
            <Button 
              data-testid="empty-create-button"
              onClick={handleCreateAgent}
              type="primary"
            >
              {t('agent_hub.button.create')}
            </Button>
          </div>
        ) : (
          <AgentList 
            selectedAgentId={selectedAgent?.id}
            onAgentSelect={handleAgentSelect}
          />
        )}
      </div>

      <div 
        data-testid="agent-details-column" 
        className="agent-details-column"
        role="main"
        aria-label={t('agent_hub.aria.main')}
      >
        {selectedAgent ? (
          <div>
            <h2>{selectedAgent.name}</h2>
            <p>{selectedAgent.description}</p>
            <p><strong>Model:</strong> {selectedAgent.model}</p>
            <p><strong>Status:</strong> {selectedAgent.status}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' }}>
            <h3>{t('agent_hub.details.no_selection')}</h3>
            <p>{t('agent_hub.details.select_agent')}</p>
          </div>
        )}
      </div>

      <div role="complementary" aria-label={t('agent_hub.aria.sidebar')}>
        {/* Sidebar content for accessibility test */}
      </div>
    </div>
  )
}

export default AgentHubPage