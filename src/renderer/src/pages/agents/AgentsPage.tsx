import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { VStack } from '@renderer/components/Layout'
import Agents from '@renderer/config/agents.json'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { covertAgentToAssistant } from '@renderer/services/assistant'
import { Agent } from '@renderer/types'
import { Col, Row, Typography } from 'antd'
import { find, groupBy } from 'lodash'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AgentCard from './components/AgentCard'
import EditAgent from './components/EditAgent'
import MyAgents from './components/MyAgents'

const { Title } = Typography

const AppsPage: FC = () => {
  const { assistants, addAssistant } = useAssistants()
  const agentGroups = groupBy(Agents, 'group')
  const { t } = useTranslation()
  const [editedAgent, setEditedAgent] = useState<Agent | null>(null)

  const onAddAgentConfirm = (agent: Agent) => {
    const added = find(assistants, { id: agent.id })

    window.modal.confirm({
      title: agent.emoji + ' ' + agent.name,
      content: (agent.description || agent.prompt).substring(0, 1000) + '...',
      icon: null,
      closable: true,
      maskClosable: true,
      centered: true,
      okButtonProps: { type: 'primary', disabled: Boolean(added) },
      okText: added ? t('button.added') : t('button.add'),
      onOk: () => onAddAgent(agent)
    })
  }

  const onAddAgent = async (agent: Agent) => {
    addAssistant(await covertAgentToAssistant(agent))
    window.message.success({
      content: t('message.assistant.added.content'),
      key: 'agent-added',
      style: { marginTop: '5vh' }
    })
  }

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('agents.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <MyAgents onClick={onAddAgentConfirm} onEdit={setEditedAgent} />
        {editedAgent && <EditAgent agent={editedAgent} onClose={() => setEditedAgent(null)} />}
        {!editedAgent && (
          <AssistantsContainer>
            <VStack style={{ flex: 1 }}>
              {Object.keys(agentGroups)
                .reverse()
                .map((group) => (
                  <div key={group}>
                    <Title level={5} key={group} style={{ marginBottom: 16 }}>
                      {group}
                    </Title>
                    <Row gutter={16}>
                      {agentGroups[group].map((agent, index) => {
                        return (
                          <Col span={8} key={group + index}>
                            <AgentCard onClick={() => onAddAgentConfirm(agent)} agent={agent as any} />
                          </Col>
                        )
                      })}
                    </Row>
                  </div>
                ))}
              <div style={{ minHeight: 20 }} />
            </VStack>
          </AssistantsContainer>
        )}
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  justify-content: center;
  height: 100%;
`

const AssistantsContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  height: calc(100vh - var(--navbar-height));
  padding: 15px 20px;
  overflow-y: scroll;
`

export default AppsPage
