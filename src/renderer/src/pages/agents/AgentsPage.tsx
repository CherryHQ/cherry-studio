import { ImportOutlined, PlusOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import ListItem from '@renderer/components/ListItem'
import Scrollbar from '@renderer/components/Scrollbar'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { useAgents } from '@renderer/hooks/useAgents'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import { createAssistantFromAgent } from '@renderer/services/AssistantService'
import { Agent } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Button, Empty, Flex, Input } from 'antd'
import { omit } from 'lodash'
import { Search } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import styled from 'styled-components'

import { groupByCategories, useSystemAgents } from '.'
import { groupTranslations } from './agentGroupTranslations'
import AddAgentPopup from './components/AddAgentPopup'
import AgentCard from './components/AgentCard'
import { AgentGroupIcon } from './components/AgentGroupIcon'
import ImportAgentPopup from './components/ImportAgentPopup'

const AgentsPage: FC = () => {
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [activeGroup, setActiveGroup] = useState('我的')
  const [agentGroups, setAgentGroups] = useState<Record<string, Agent[]>>({})
  const [isSearchExpanded, setIsSearchExpanded] = useState(false)
  const systemAgents = useSystemAgents()
  const { agents: userAgents } = useAgents()
  const { isTopNavbar } = useNavbarPosition()

  useEffect(() => {
    const systemAgentsGroupList = groupByCategories(systemAgents)
    const agentsGroupList = {
      我的: userAgents,
      精选: [],
      ...systemAgentsGroupList
    } as Record<string, Agent[]>
    setAgentGroups(agentsGroupList)
  }, [systemAgents, userAgents])

  const filteredAgents = useMemo(() => {
    // 搜索框为空直接返回「我的」分组下的 agent
    if (!search.trim()) {
      return agentGroups[activeGroup] || []
    }
    const uniqueAgents = new Map<string, Agent>()
    Object.entries(agentGroups).forEach(([, agents]) => {
      agents.forEach((agent) => {
        if (
          agent.name.toLowerCase().includes(search.toLowerCase()) ||
          agent.description?.toLowerCase().includes(search.toLowerCase())
        ) {
          uniqueAgents.set(agent.id, agent)
        }
      })
    })
    return Array.from(uniqueAgents.values())
  }, [agentGroups, activeGroup, search])

  const { t, i18n } = useTranslation()

  const onAddAgentConfirm = useCallback(
    (agent: Agent) => {
      window.modal.confirm({
        title: agent.name,
        content: (
          <Flex gap={16} vertical style={{ width: 'calc(100% + 12px)' }}>
            {agent.description && <AgentDescription>{agent.description}</AgentDescription>}

            {agent.prompt && (
              <AgentPrompt className="markdown">
                <ReactMarkdown>{agent.prompt}</ReactMarkdown>
              </AgentPrompt>
            )}
          </Flex>
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

  const getAgentFromSystemAgent = useCallback((agent: (typeof systemAgents)[number]) => {
    return {
      ...omit(agent, 'group'),
      name: agent.name,
      id: uuid(),
      topics: [],
      type: 'agent'
    }
  }, [])

  const getLocalizedGroupName = useCallback(
    (group: string) => {
      const currentLang = i18n.language
      return groupTranslations[group]?.[currentLang] || group
    },
    [i18n.language]
  )

  const handleSearch = () => {
    if (searchInput.trim() === '') {
      setSearch('')
      setActiveGroup('我的')
    } else {
      setActiveGroup('')
      setSearch(searchInput)
    }
  }

  const handleSearchClear = () => {
    setSearch('')
    setSearchInput('')
    setActiveGroup('我的')
    setIsSearchExpanded(false)
  }

  const handleSearchIconClick = () => {
    if (!isSearchExpanded) {
      setIsSearchExpanded(true)
    } else {
      handleSearch()
    }
  }

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchInput(value)
    // 如果输入内容为空，折叠搜索框
    if (value.trim() === '') {
      setIsSearchExpanded(false)
      setSearch('')
      setActiveGroup('我的')
    }
  }

  const handleSearchInputBlur = () => {
    // 如果输入内容为空，失焦时折叠搜索框
    if (searchInput.trim() === '') {
      setIsSearchExpanded(false)
    }
  }

  const handleGroupClick = (group: string) => () => {
    setSearch('')
    setSearchInput('')
    setActiveGroup(group)
  }

  const handleAddAgent = () => {
    AddAgentPopup.show().then(() => {
      handleSearchClear()
    })
  }

  const handleImportAgent = async () => {
    try {
      await ImportAgentPopup.show()
    } catch (error) {
      window.message.error({
        content: error instanceof Error ? error.message : t('message.agents.import.error'),
        key: 'agents-import-error'
      })
    }
  }

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none', justifyContent: 'space-between' }}>
          {t('agents.title')}
          <Input
            placeholder={t('common.search')}
            className="nodrag"
            style={{ width: '30%', height: 28, borderRadius: 15, paddingLeft: 12 }}
            size="small"
            variant="filled"
            allowClear
            onClear={handleSearchClear}
            suffix={<Search size={14} color="var(--color-icon)" onClick={handleSearch} />}
            value={searchInput}
            maxLength={50}
            onChange={handleSearchInputChange}
            onPressEnter={handleSearch}
            onBlur={handleSearchInputBlur}
          />
          <div style={{ width: 80 }} />
        </NavbarCenter>
      </Navbar>

      <Main id="content-container">
        <AgentsGroupList>
          {Object.entries(agentGroups).map(([group]) => (
            <ListItem
              active={activeGroup === group && !search.trim()}
              key={group}
              title={
                <Flex gap={16} align="center" justify="space-between">
                  <Flex gap={10} align="center">
                    <AgentGroupIcon groupName={group} />
                    {getLocalizedGroupName(group)}
                  </Flex>
                  {
                    <HStack alignItems="center" justifyContent="center" style={{ minWidth: 40 }}>
                      <CustomTag color="#A0A0A0" size={8}>
                        {agentGroups[group].length}
                      </CustomTag>
                    </HStack>
                  }
                </Flex>
              }
              style={{ margin: '0 8px', paddingLeft: 16, paddingRight: 16 }}
              onClick={handleGroupClick(group)}></ListItem>
          ))}
        </AgentsGroupList>

        <AgentsListContainer>
          <AgentsListHeader>
            <AgentsListTitle>
              {search.trim() ? (
                <>
                  <AgentGroupIcon groupName="搜索" size={24} />
                  {search.trim()}{' '}
                </>
              ) : (
                <>
                  <AgentGroupIcon groupName={activeGroup} size={24} />
                  {getLocalizedGroupName(activeGroup)}
                </>
              )}

              {
                <CustomTag color="#A0A0A0" size={10}>
                  {filteredAgents.length}
                </CustomTag>
              }
            </AgentsListTitle>
            <Flex gap={8}>
              {isSearchExpanded ? (
                <Input
                  placeholder={t('common.search')}
                  className="nodrag"
                  style={{ width: 300, height: 28, borderRadius: 15, paddingLeft: 12 }}
                  size="small"
                  variant="filled"
                  allowClear
                  onClear={handleSearchClear}
                  suffix={<Search size={14} color="var(--color-icon)" onClick={handleSearchIconClick} />}
                  value={searchInput}
                  maxLength={50}
                  onChange={handleSearchInputChange}
                  onPressEnter={handleSearch}
                  onBlur={handleSearchInputBlur}
                  autoFocus
                />
              ) : (
                isTopNavbar && (
                  <Button
                    type="text"
                    onClick={handleSearchIconClick}
                    icon={<Search size={18} color="var(--color-icon)" />}>
                    {t('common.search')}
                  </Button>
                )
              )}
              <Button type="text" onClick={handleImportAgent} icon={<ImportOutlined />}>
                {t('agents.import.title')}
              </Button>
              <Button type="text" onClick={handleAddAgent} icon={<PlusOutlined />}>
                {t('agents.add.title')}
              </Button>
            </Flex>
          </AgentsListHeader>

          {filteredAgents.length > 0 ? (
            <AgentsList>
              {filteredAgents.map((agent, index) => (
                <AgentCard
                  key={agent.id || index}
                  onClick={() => onAddAgentConfirm(getAgentFromSystemAgent(agent))}
                  agent={agent}
                  activegroup={activeGroup}
                  getLocalizedGroupName={getLocalizedGroupName}
                />
              ))}
            </AgentsList>
          ) : (
            <EmptyView>
              <Empty description={t('agents.search.no_results')} />
            </EmptyView>
          )}
        </AgentsListContainer>
      </Main>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
`

const AgentsGroupList = styled(Scrollbar)`
  min-width: 160px;
  height: calc(100vh - var(--navbar-height));
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 0;
  border-right: 0.5px solid var(--color-border);
  border-top-left-radius: inherit;
  border-bottom-left-radius: inherit;
  -ms-overflow-style: none;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`

const Main = styled.div`
  flex: 1;
  display: flex;
`

const AgentsListContainer = styled.div`
  height: calc(100vh - var(--navbar-height));
  flex: 1;
  display: flex;
  flex-direction: column;
`

const AgentsListHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 12px;
`

const AgentsListTitle = styled.div`
  font-size: 16px;
  line-height: 18px;
  font-weight: 500;
  color: var(--color-text-1);
  display: flex;
  align-items: center;
  gap: 8px;
`

const AgentsList = styled(Scrollbar)`
  flex: 1;
  padding: 8px 16px 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  grid-auto-rows: 160px;
  gap: 16px;
`

const AgentDescription = styled.div`
  color: var(--color-text-2);
  font-size: 12px;
`

const AgentPrompt = styled.div`
  max-height: 60vh;
  overflow-y: scroll;
  background-color: var(--color-background-soft);
  padding: 8px;
  border-radius: 10px;
`

const EmptyView = styled.div`
  height: 100%;
  display: flex;
  flex: 1;
  justify-content: center;
  align-items: center;
  font-size: 16px;
  color: var(--color-text-secondary);
`

export default AgentsPage
