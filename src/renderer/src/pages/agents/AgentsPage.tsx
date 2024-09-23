import { UnorderedListOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import Agents from '@renderer/config/agents.json'
import { useAgents } from '@renderer/hooks/useAgents'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { covertAgentToAssistant } from '@renderer/services/assistant'
import { Agent } from '@renderer/types'
import { Col, Row, Typography } from 'antd'
import { find, groupBy } from 'lodash'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AgentCard from './components/AgentCard'
import ManageAgentsPopup from './components/ManageAgentsPopup'
import UserAgents from './components/UserAgents'

const { Title } = Typography

const AppsPage: FC = () => {
  const { assistants, addAssistant } = useAssistants()
  const { agents } = useAgents()
  const agentGroups = groupBy(Agents, 'group')
  const { t } = useTranslation()

  const onAddAgentConfirm = (agent: Agent) => {
    const added = find(assistants, { id: agent.id })

    window.modal.confirm({
      title: agent.emoji + ' ' + agent.name,
      content: agent.description || agent.prompt,
      icon: null,
      closable: true,
      maskClosable: true,
      centered: true,
      okButtonProps: { type: 'primary', disabled: Boolean(added) },
      okText: added ? t('button.added') : t('button.add'),
      onOk: () => onAddAgent(agent)
    })
  }

  const onAddAgent = (agent: Agent) => {
    addAssistant(covertAgentToAssistant(agent))
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
        <AssistantsContainer>
          <HStack alignItems="center" style={{ marginBottom: 16 }}>
            <Title level={4}>{t('agents.my_agents')}</Title>
            {agents.length > 0 && <ManageIcon onClick={ManageAgentsPopup.show} />}
          </HStack>
          <UserAgents onAdd={onAddAgentConfirm} />
          {Object.keys(agentGroups).map((group) => (
            <div key={group}>
              <Title level={4} key={group} style={{ marginBottom: 16 }}>
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
        </AssistantsContainer>
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
  overflow-y: scroll;
`

const AssistantsContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: calc(100vh - var(--navbar-height));
  padding: 20px;
  max-width: 1000px;
`

const ManageIcon = styled(UnorderedListOutlined)`
  font-size: 18px;
  color: var(--color-icon);
  cursor: pointer;
  margin-bottom: 0.5em;
  margin-left: 0.5em;
`

export default AppsPage
