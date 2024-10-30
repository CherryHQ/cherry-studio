import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import SystemAgents from '@renderer/config/agents.json'
import { createAssistantFromAgent } from '@renderer/services/AssistantService'
import { Agent } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Col, Empty, Input, Row, Tabs as TabsAntd, Typography } from 'antd'
import { groupBy, omit } from 'lodash'
import { FC, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import styled from 'styled-components'

import Agents from './Agents'
import AddAgentPopup from './components/AddAgentPopup'
import AgentCard from './components/AgentCard'

const { Title } = Typography

const getAgentsFromSystemAgents = () => {
  const agents: Agent[] = []
  for (let i = 0; i < SystemAgents.length; i++) {
    for (let j = 0; j < SystemAgents[i].group.length; j++) {
      const agent = { ...SystemAgents[i], group: SystemAgents[i].group[j], topics: [], type: 'agent' } as Agent
      agents.push(agent)
    }
  }
  return agents
}

let _agentGroups: Record<string, Agent[]> = {}

const AgentsPage: FC = () => {
  const [search, setSearch] = useState('')

  const agentGroups = useMemo(() => {
    if (Object.keys(_agentGroups).length === 0) {
      _agentGroups = groupBy(getAgentsFromSystemAgents(), 'group')
    }
    return _agentGroups
  }, [])

  const { t } = useTranslation()

  const filteredAgentGroups = useMemo(() => {
    const groups = search.trim() ? {} : { 我的: [] }

    if (!search.trim()) {
      Object.entries(agentGroups).forEach(([group, agents]) => {
        groups[group] = agents
      })
      return groups
    }

    Object.entries(agentGroups).forEach(([group, agents]) => {
      const filteredAgents = agents.filter(
        (agent) =>
          agent.name.toLowerCase().includes(search.toLowerCase()) ||
          agent.description?.toLowerCase().includes(search.toLowerCase())
      )
      if (filteredAgents.length > 0) {
        groups[group] = filteredAgents
      }
    })
    return groups
  }, [agentGroups, search])

  const getAgentName = (agent: Agent) => {
    return agent.emoji ? agent.emoji + ' ' + agent.name : agent.name
  }

  const onAddAgentConfirm = useCallback(
    (agent: Agent) => {
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
    },
    [t]
  )

  const getAgentFromSystemAgent = (agent: (typeof SystemAgents)[number]) => {
    return {
      ...omit(agent, 'group'),
      name: agent.name,
      id: uuid(),
      topics: [],
      type: 'agent'
    }
  }

  const tabItems = useMemo(() => {
    let groups = Object.keys(filteredAgentGroups)
    groups = groups.filter((g) => g !== '我的' && g !== '办公')
    groups = ['我的', '办公', ...groups]

    return groups.map((group, i) => {
      const id = String(i + 1)
      return {
        label: group,
        key: id,
        children: (
          <TabContent key={group}>
            <Title level={5} key={group} style={{ marginBottom: 16 }}>
              {group}
            </Title>
            <Row gutter={[32, 32]}>
              {group === '我的' ? (
                <>
                  <Col span={8}>
                    <AddAgentCard onClick={() => AddAgentPopup.show()} />
                  </Col>
                  <Agents onClick={onAddAgentConfirm} cardStyle="new" />
                </>
              ) : (
                filteredAgentGroups[group]?.map((agent, index) => (
                  <Col span={8} key={group + index}>
                    <AgentCard onClick={() => onAddAgentConfirm(getAgentFromSystemAgent(agent))} agent={agent as any} />
                  </Col>
                ))
              )}
            </Row>
          </TabContent>
        )
      }
    })
  }, [filteredAgentGroups, onAddAgentConfirm])

  return (
    <StyledContainer>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none', justifyContent: 'space-between' }}>
          {t('agents.title')}
          <Input
            placeholder={t('common.search')}
            className="nodrag"
            style={{ width: '30%', height: 28 }}
            size="small"
            variant="filled"
            allowClear
            suffix={<SearchOutlined />}
            value={search}
            maxLength={50}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ width: 80 }} />
        </NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <AssistantsContainer>
          {tabItems.length > 0 ? (
            <Tabs tabPosition="left" animated items={tabItems} />
          ) : (
            <EmptyView>
              <Empty description={t('agents.search.no_results')} />
            </EmptyView>
          )}
        </AssistantsContainer>
      </ContentContainer>
    </StyledContainer>
  )
}

const StyledContainer = styled.div`
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
`

const TabContent = styled(Scrollbar)`
  height: calc(100vh - var(--navbar-height));
  padding: 10px 10px 10px 15px;
  margin-right: 4px;
`

const AgentPrompt = styled.div`
  max-height: 60vh;
  overflow-y: scroll;
  max-width: 560px;
`

const EmptyView = styled.div`
  display: flex;
  flex: 1;
  justify-content: center;
  align-items: center;
  font-size: 16px;
  color: var(--color-text-secondary);
  border-left: 0.5px solid var(--color-border);
`

const Tabs = styled(TabsAntd)`
  display: flex;
  flex: 1;
  flex-direction: row-reverse;
  .ant-tabs-tabpane {
    padding-left: 0 !important;
  }
  .ant-tabs-nav-list {
    padding: 10px 8px;
  }
  .ant-tabs-nav-operations {
    display: none !important;
  }
  .ant-tabs-tab {
    margin: 0 !important;
    border-radius: 20px;
    margin-bottom: 5px !important;
    font-size: 14px;
    justify-content: center;
    &:hover {
      color: var(--color-text) !important;
      background-color: var(--color-background-soft);
    }
  }
  .ant-tabs-tab-active {
    background-color: var(--color-background-mute);
    border-right: none;
  }
  .ant-tabs-content-holder {
    border-left: 0.5px solid var(--color-border);
    border-right: 0.5px solid var(--color-border);
  }
  .ant-tabs-ink-bar {
    display: none;
  }
  .ant-tabs-tab-btn:active {
    color: var(--color-text) !important;
  }
  .ant-tabs-tab-active {
    .ant-tabs-tab-btn {
      color: var(--color-text) !important;
    }
  }
`

const AddAgentCard = styled(({ onClick, className }: { onClick: () => void; className?: string }) => {
  const { t } = useTranslation()

  return (
    <div className={className} onClick={onClick}>
      <PlusOutlined style={{ fontSize: 24 }} />
      <span style={{ marginTop: 10 }}>{t('agents.add.title')}</span>
    </div>
  )
})`
  width: 100%;
  height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: var(--color-background);
  border-radius: 15px;
  border: 1px dashed var(--color-border);
  cursor: pointer;
  transition: all 0.3s ease;
  color: var(--color-text-soft);

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
`

export default AgentsPage
