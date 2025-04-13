import { SearchOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { Center } from '@renderer/components/Layout'
import { useWorkflows } from '@renderer/hooks/useFlowEngineProvider'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { Divider, Empty, Input } from 'antd'
import { isEmpty } from 'lodash'
import React, { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import App from './App'
import WorkflowApp from './WorkflowApp'

const AppsPage: FC = () => {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const { minapps } = useMinapps()
  const { workflows } = useWorkflows()

  const filteredApps = search
    ? minapps.filter(
        (app) => app.name.toLowerCase().includes(search.toLowerCase()) || app.url.includes(search.toLowerCase())
      )
    : minapps
  console.log('filteredApps', filteredApps)

  const filteredWorkflows = search
    ? workflows.filter(
        (app) => app.name.toLowerCase().includes(search.toLowerCase()) || app.url.includes(search.toLowerCase())
      )
    : workflows
  console.log('filteredWorkflows', filteredWorkflows)

  // Calculate the required number of lines
  const itemsPerRow = Math.floor(930 / 115) // Maximum width divided by the width of each item (including spacing)
  const rowCount = Math.ceil(filteredApps.length / itemsPerRow)
  // Each line height is 85px (60px icon + 5px margin + 12px text + spacing)
  const containerHeight = rowCount * 85 + (rowCount - 1) * 25 // 25px is the line spacing.

  // Disable right-click menu in blank area
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  return (
    <Container onContextMenu={handleContextMenu}>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none', justifyContent: 'space-between' }}>
          {t('minapp.title')}
          <Input
            placeholder={t('common.search')}
            className="nodrag"
            style={{ width: '30%', height: 28 }}
            size="small"
            variant="filled"
            suffix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ width: 80 }} />
        </NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        {isEmpty(filteredApps) ? (
          <Center>
            <Empty />
          </Center>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', maxWidth: '930px' }}>
            <ContainerTitle>{t('minapp.title')}</ContainerTitle>
            <AppsContainer style={{ height: containerHeight }}>
              {filteredApps.map((app) => (
                <App key={app.id} app={app} />
              ))}
            </AppsContainer>
            <AppDivider />
            <ContainerTitle>{t('workflow.title')}</ContainerTitle>
            <AppsContainer style={{ height: containerHeight }}>
              {filteredWorkflows.map((workflow) => (
                <WorkflowApp key={workflow.id} workflowApp={workflow.miniAppConfig} />
              ))}
            </AppsContainer>
          </div>
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
  overflow-y: auto;
  padding: 50px;
`

const AppsContainer = styled.div`
  display: grid;
  min-width: 0;
  max-width: 930px;
  width: 100%;
  grid-template-columns: repeat(auto-fill, 90px);
  gap: 25px;
  justify-content: center;
`

const AppDivider = styled(Divider)`
  margin: 10px 0;
  border-block-start: 0.5px solid var(--color-border);
`

const ContainerTitle = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  user-select: none;
  font-size: 14px;
  font-weight: bold;
`
export default AppsPage
