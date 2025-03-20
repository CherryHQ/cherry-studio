import { SearchOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { Center } from '@renderer/components/Layout'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { MinAppType } from '@renderer/types'
import { Empty, Input } from 'antd'
import { isEmpty } from 'lodash'
import React, { FC, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import App from './App'
const RECENTLY_USE_MAX = 6
const AppsPage: FC = () => {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const { minapps, recentlyUse, updateRecentlyUseMinapps } = useMinapps()

  const filteredApps = search
    ? minapps.filter(
        (app) => app.name.toLowerCase().includes(search.toLowerCase()) || app.url.includes(search.toLowerCase())
      )
    : minapps

  // Calculate the required number of lines
  const itemsPerRow = Math.floor(930 / 115) // Maximum width divided by the width of each item (including spacing)
  const rowCount = Math.ceil(filteredApps.length / itemsPerRow)
  // Each line height is 85px (60px icon + 5px margin + 12px text + spacing)
  const containerHeight = rowCount * 85 + (rowCount - 1) * 25 // 25px is the line spacing.

  // Disable right-click menu in blank area
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  const handleClick = useCallback(
    (app: MinAppType) => {
      let updatedRecentlyUse = recentlyUse.slice(-1 * RECENTLY_USE_MAX) // 兼容长度变化
      const matchedAppIndex = updatedRecentlyUse.findIndex((item) => item.id === app.id)

      if (matchedAppIndex === -1) {
        updatedRecentlyUse.push({ ...app, timestamp: Date.now() })
      } else {
        updatedRecentlyUse[matchedAppIndex] = { ...updatedRecentlyUse[matchedAppIndex], timestamp: Date.now() }
      }

      // 按时间戳降序排序
      updatedRecentlyUse.sort((a, b) => b.timestamp - a.timestamp)
      if (updatedRecentlyUse.length > RECENTLY_USE_MAX) {
        updatedRecentlyUse = updatedRecentlyUse.slice(-1 * RECENTLY_USE_MAX)
      }

      updateRecentlyUseMinapps(updatedRecentlyUse)
    },
    [recentlyUse]
  )

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
        {recentlyUse.length > 0 && (
          <RecentlyUseContainer>
            <AppsContainer style={{ display: 'flex', flexDirection: 'row', gap: '50px' }}>
              {recentlyUse.slice(-1 * RECENTLY_USE_MAX).map((app) => (
                <App key={app.id} app={app} onClick={() => handleClick(app)} />
              ))}
            </AppsContainer>
            <Divider />
          </RecentlyUseContainer>
        )}
        {isEmpty(filteredApps) ? (
          <Center>
            <Empty />
          </Center>
        ) : (
          <AppsContainer style={{ height: containerHeight }}>
            {filteredApps.map((app) => (
              <App key={app.id} app={app} onClick={() => handleClick(app)} />
            ))}
          </AppsContainer>
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
  flex-direction: column;
  align-items: center;
  height: 100%;
  overflow-y: auto;
  padding: 30px 50px;
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
const RecentlyUseContainer = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 930px;
  width: 100%;
  align-items: center;
  margin-bottom: 20px;
`
const Divider = styled.div`
  width: 100%;
  border: 1px dashed #e0e0e0;
  margin-top: 20px;
`
export default AppsPage
