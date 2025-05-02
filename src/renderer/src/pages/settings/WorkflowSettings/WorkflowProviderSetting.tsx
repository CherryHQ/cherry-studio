import { ArrowLeftOutlined, ExportOutlined, PartitionOutlined, PlusOutlined } from '@ant-design/icons'
import { nanoid } from '@reduxjs/toolkit'
import IndicatorLight from '@renderer/components/IndicatorLight'
import { HStack, VStack } from '@renderer/components/Layout'
import { FLOW_ENGINE_PROVIDER_CONFIG } from '@renderer/config/workflowProviders'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useFlowEngineProvider } from '@renderer/hooks/useFlowEngineProvider'
import { Flow, FlowEngine } from '@renderer/types'
import { Divider, Flex, Switch } from 'antd'
import Link from 'antd/es/typography/Link'
import { FC, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingTitle } from '..'
import WorkflowSettings from './WorkflowSettings'

interface Props {
  flowEngineProvider: FlowEngine
}

const WorkflowProviderSetting: FC<Props> = ({ flowEngineProvider: _flowEngineProvider }) => {
  const { theme } = useTheme()
  const { flowEngineProvider, flows, updateFlowEngineProvider, addFlow } = useFlowEngineProvider(_flowEngineProvider.id)
  const [selectedFlow, setSelectedFlow] = useState<Flow | null>(null)
  const { t } = useTranslation()
  const providerConfig = FLOW_ENGINE_PROVIDER_CONFIG[flowEngineProvider.id]
  const officialWebsite = providerConfig?.websites?.official

  const onAddFlow = async () => {
    const newFlow: Flow = {
      id: nanoid(),
      type: 'workflow',
      providerId: flowEngineProvider.id,
      name: t('settings.workflow.newWorkflow'),
      description: '',
      apiKey: '',
      apiHost: providerConfig.apiHost,
      enabled: false
    }
    addFlow(newFlow)
    window.message.success({ content: t('settings.workflow.addSuccess'), key: 'workflow-list' })
    setSelectedFlow(newFlow)
  }

  const MainContent = useMemo(() => {
    if (selectedFlow) {
      return <WorkflowSettings flow={selectedFlow} />
    }
    return
  }, [flows, selectedFlow])

  const goBackToGrid = () => {
    setSelectedFlow(null)
  }

  useEffect(() => {
    // Check if the selected workflow still exists in the updated workflows
    if (selectedFlow) {
      const workflowExists = flows.some((w) => w.id === selectedFlow.id)
      if (!workflowExists) {
        setSelectedFlow(null)
      }
    } else {
      setSelectedFlow(null)
    }
  }, [flows, setSelectedFlow])

  return (
    <SettingContainer theme={theme} style={{ background: 'var(--color-background)' }}>
      <SettingTitle>
        <Flex align="center" gap={8}>
          <ProviderName>
            {flowEngineProvider.isSystem ? t(`provider.${flowEngineProvider.id}`) : flowEngineProvider.name}
          </ProviderName>
          {officialWebsite! && (
            <Link target="_blank" href={providerConfig.websites.official}>
              <ExportOutlined style={{ color: 'var(--color-text)', fontSize: '12px' }} />
            </Link>
          )}
        </Flex>
        <Switch
          value={flowEngineProvider.enabled}
          key={flowEngineProvider.id}
          onChange={(enabled) => updateFlowEngineProvider({ ...flowEngineProvider, enabled })}
        />
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      <Container>
        {selectedFlow ? (
          <DetailViewContainer>
            <BackButtonContainer>
              <BackButton onClick={goBackToGrid}>
                <ArrowLeftOutlined /> {t('common.back')}
              </BackButton>
            </BackButtonContainer>
            <DetailContent>{MainContent}</DetailContent>
          </DetailViewContainer>
        ) : (
          <GridContainer>
            <WorkflowsGrid>
              <AddWorkflowCard onClick={onAddFlow}>
                <PlusOutlined style={{ fontSize: 24 }} />
                <AddWorkflowText>{t('settings.workflow.addWorkflow')}</AddWorkflowText>
              </AddWorkflowCard>
              {flows.map((workflow) => (
                <WorkflowCard
                  key={workflow.id}
                  onClick={() => {
                    setSelectedFlow(workflow)
                  }}>
                  <WorkflowHeader>
                    <WorkflowIcon>
                      <PartitionOutlined />
                    </WorkflowIcon>
                    <WorkflowName>{workflow.name}</WorkflowName>
                    <StatusIndicator>
                      <IndicatorLight
                        size={6}
                        color={workflow.enabled ? 'green' : 'var(--color-text-3)'}
                        animation={workflow.enabled}
                        shadow={false}
                      />
                    </StatusIndicator>
                  </WorkflowHeader>
                  <WorkflowDescription>
                    {workflow.description
                      ? workflow.description.substring(0, 60) + (workflow.description.length > 60 ? '...' : '')
                      : t('settings.workflow.noDescription')}
                  </WorkflowDescription>
                </WorkflowCard>
              ))}
            </WorkflowsGrid>
          </GridContainer>
        )}
      </Container>
    </SettingContainer>
  )
}

const ProviderName = styled.span`
  font-size: 14px;
  font-weight: 500;
`

const Container = styled(HStack)`
  flex: 1;
  width: 100%;
  overflow: hidden; /* 防止容器本身滚动 */
`

const GridContainer = styled(VStack)`
  width: 100%;
  height: 100%;
  padding: 20px;
  overflow: hidden;
`

const WorkflowsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  width: 100%;
  overflow-y: auto; /* 只有当内容超出时才会滚动 */
  padding: 2px;
`

const WorkflowCard = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  height: 140px;
  background-color: var(--color-bg-1);
  &:hover {
    border-color: var(--color-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    transform: translateY(-2px);
  }
`

const AddWorkflowCard = styled(WorkflowCard)`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  border-style: dashed;
  background-color: transparent;
  color: var(--color-text-2);
`

const AddWorkflowText = styled.div`
  margin-top: 12px;
  font-weight: 500;
`

const WorkflowHeader = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 12px;
`

const WorkflowIcon = styled.div`
  font-size: 18px;
  color: var(--color-primary);
  margin-right: 8px;
`

const WorkflowName = styled.div`
  font-weight: 500;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const StatusIndicator = styled.div`
  margin-left: 8px;
`

const WorkflowDescription = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
`

const DetailViewContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden; /* 添加这一行，防止这一层产生滚动 */
`

const BackButtonContainer = styled.div`
  padding: 16px 0 0 20px;
  width: 100%;
`

const DetailContent = styled.div`
  flex: 1;
  width: 100%;
  padding: 5px 10px 5px 5px; /* 合并右侧内边距设置 */
  overflow-y: auto; /* 保持此处的滚动 */
`

const BackButton = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-1);
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 4px;
  margin-bottom: 10px;
  background-color: var(--color-bg-1);

  &:hover {
    color: var(--color-primary);
    background-color: var(--color-bg-2);
  }
`

export default WorkflowProviderSetting
