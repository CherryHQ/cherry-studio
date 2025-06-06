import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { VStack } from '@renderer/components/Layout'
import SystemAgents from '@renderer/config/agents.json'
import { createAssistantFromAgent } from '@renderer/services/assistant'
import { Agent } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Col, Row, Typography } from 'antd'
import { groupBy, omit } from 'lodash'
import { FC, useState } from 'react' // Added useState
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import FuturisticTUI from '@renderer/components/FuturisticTUI/FuturisticTUI'; // Added FuturisticTUI
import styled from 'styled-components'

import Agents from './Agents'
import AgentCard from './components/AgentCard'

const { Title } = Typography

const AgentsPage: FC = () => {
  const agentGroups = groupBy(SystemAgents, 'group')
  const { t } = useTranslation()
  const [selectedAgentForTUI, setSelectedAgentForTUI] = useState<Agent | null>(null); // Added state

  // Inside AgentsPage component
  // The agentId parameter here will be supplied by FuturisticTUI when it calls this function
  const handleTUICommandSubmit = async (command: string, agentIdFromTUI?: string): Promise<string | null> => {
    // Prefer agentIdFromTUI if provided by the component, otherwise fallback to selectedAgentForTUI
    const targetAgentId = agentIdFromTUI || selectedAgentForTUI?.id;

    if (!targetAgentId) {
      console.error('TUI Command Submit: No agent ID available.');
      return 'Error: No agent selected or ID missing.';
    }
    console.log(`TUI Command Submit for agent ${targetAgentId}: "${command}"`);
    try {
      if (window.api && window.api.agentMultiplexer && window.api.agentMultiplexer.sendMessage) {
        const result = await window.api.agentMultiplexer.sendMessage(targetAgentId, command);
        // The IPC call for sendMessage was defined as:
        // ipcMain.handle('agentMultiplexer:sendMessage', async (_, agentId: string, message: string, images?: string[])
        // and returns { response } or { response: null, error }
        // The preload maps this to: sendMessage: (agentId: string, message: string, images?: string[]) => ipcRenderer.invoke(...)
        // So, 'result' will be the object { response: string | null, error?: string }

        if (result.error) {
          console.error('IPC Error from agentMultiplexer:sendMessage:', result.error);
          return `Backend Error: ${result.error}`;
        }
        // result.response can be null if the agent didn't return anything or if there was a non-exception error server-side
        return result.response === undefined || result.response === null ? 'Agent processed the command but returned no specific textual response.' : result.response;
      } else {
        console.error('Agent Multiplexer API not available on window.api');
        return 'Error: Agent communication API is not available.';
      }
    } catch (error: any) {
      console.error('Error submitting TUI command via IPC:', error);
      return `IPC Error: ${error.message || 'Failed to send command.'}`;
    }
  };

  const getAgentName = (agent: Agent) => {
    return agent.emoji ? agent.emoji + ' ' + agent.name : agent.name
  }

  const onAddAgentConfirm = (agent: Agent) => {
    window.modal.confirm({
      title: getAgentName(agent),
      content: (
        <AgentPrompt>
          <ReactMarkdown className="markdown">{agent.description || agent.prompt}</ReactMarkdown>
        </AgentPrompt>
      ),
      width: 600,
      icon: null,
      closable: true,
      maskClosable: true,
      centered: true,
      okButtonProps: { type: 'primary' },
      okText: t('agents.add.button'),
      onOk: () => createAssistantFromAgent(agent)
    })
  }

  const getAgentFromSystemAgent = (agent: (typeof SystemAgents)[number]) => {
    return {
      ...omit(agent, 'group'),
      name: agent.name,
      id: uuid(),
      topics: [],
      type: 'agent'
    }
  }

  return (
    <Container> {/* This is the root styled component for the page, ensure it's defined */}
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('agents.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container"> {/* New flex-column ContentContainer */}
        <AgentsSelectionArea>
          {/*
            The original <Agents onClick={onAddAgentConfirm} /> line should be removed
            or commented out if it's not the primary way SystemAgents were displayed.
            The mapping below handles SystemAgents.
          */}
          {/* <Agents onClick={onAddAgentConfirm} /> */}
          <VStack style={{ flex: 1 }}> {/* This VStack was inside the original AssistantsContainer */}
            {Object.keys(agentGroups)
              .reverse()
              .map((group) => (
                <div key={group}>
                  <Title level={5} key={group} style={{ marginBottom: 16 }}>
                    {group}
                  </Title>
                  <Row gutter={16}>
                    {agentGroups[group].map((sysAgent, index) => {
                      const agentToPassOnClick = getAgentFromSystemAgent(sysAgent as any);
                      return (
                        <Col span={8} key={group + index}>
                          <AgentCard
                            onClick={() => {
                              setSelectedAgentForTUI(agentToPassOnClick);
                              onAddAgentConfirm(agentToPassOnClick); // This shows the modal for adding assistant
                            }}
                            agent={sysAgent as any}
                          />
                        </Col>
                      );
                    })}
                  </Row>
                </div>
              ))}
            <div style={{ minHeight: 20 }} />
          </VStack>
        </AgentsSelectionArea>

        <TUIWrapper>
          {selectedAgentForTUI ? (
            <FuturisticTUI
              key={selectedAgentForTUI.id} // Ensures TUI remounts/resets if agent changes
              agentId={selectedAgentForTUI.id}
              onCommandSubmit={handleTUICommandSubmit} // Pass the handler
            />
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '20px',
              color: 'var(--color-text-3)', // Use a theme variable if available, e.g. text-faded
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%'
            }}>
              Select an agent from the list above to interact via TUI.
            </div>
          )}
        </TUIWrapper>
      </ContentContainer>
    </Container>
  );
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
`;

const ContentContainer = styled.div`
  display: flex;
  flex-direction: column; // Changed to column for top/bottom layout
  flex: 1;
  overflow: hidden;
  height: calc(100vh - var(--navbar-height)); // Ensure it takes available height below navbar
`;

const AgentsSelectionArea = styled.div`
  padding: 15px 20px;
  overflow-y: auto;
  max-height: 45vh; /* Adjustable: e.g. 40-50% of viewport height */
  border-bottom: 1px solid var(--color-border-soft); // Optional separator
  flex-shrink: 0; // Prevent this area from shrinking excessively
`;

const TUIWrapper = styled.div`
  flex-grow: 1; // TUI takes remaining vertical space
  padding: 10px;
  background-color: #080808; // A very dark background for the TUI area
  min-height: 0; // Crucial for flex-grow to work correctly in a shrinking container
  display: flex;
  flex-direction: column; // To ensure FuturisticTUI can expand height 100%
`;

const AgentPrompt = styled.div`
  max-height: 60vh;
  overflow-y: scroll;
  max-width: 560px;
`

export default AgentsPage
