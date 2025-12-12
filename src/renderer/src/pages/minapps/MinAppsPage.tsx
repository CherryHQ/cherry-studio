import { PlusOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { Navbar, NavbarMain } from '@renderer/components/app/Navbar'
import App from '@renderer/components/MinApp/MinApp'
import Scrollbar from '@renderer/components/Scrollbar'
import { loadCustomMiniApp, ORIGIN_DEFAULT_MIN_APPS, updateDefaultMinApps } from '@renderer/config/minapps'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import type { MinAppType } from '@renderer/types'
import { Button, Input } from 'antd'
import { Search, SettingsIcon } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import MiniAppFormModal from './MiniAppFormModal'
import MinappSettingsPopup from './MiniappSettings/MinappSettingsPopup'

const logger = loggerService.withContext('AppsPage')

const AppsPage: FC = () => {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [modalVisible, setModalVisible] = useState(false)
  const [editingApp, setEditingApp] = useState<MinAppType | null>(null)
  const { minapps, updateMinapps } = useMinapps()
  const { isTopNavbar } = useNavbarPosition()

  const isEditMode = editingApp !== null

  const filteredApps = search
    ? minapps.filter(
        (app) => app.name.toLowerCase().includes(search.toLowerCase()) || app.url.includes(search.toLowerCase())
      )
    : minapps

  // Calculate the required number of lines
  const itemsPerRow = Math.floor(930 / 115) // Maximum width divided by the width of each item (including spacing)
  const rowCount = Math.ceil((filteredApps.length + 1) / itemsPerRow) // +1 for the add button
  // Each line height is 85px (60px icon + 5px margin + 12px text + spacing)
  const containerHeight = rowCount * 85 + (rowCount - 1) * 25 // 25px is the line spacing.

  // Disable right-click menu in blank area
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  const handleOpenEditModal = (app: MinAppType) => {
    setEditingApp(app)
    setModalVisible(true)
  }

  const handleAddCustomApp = async (newApp: MinAppType) => {
    try {
      const content = await window.api.file.read('custom-minapps.json')
      const customApps = JSON.parse(content)

      // Check for duplicate ID
      if (customApps.some((app: MinAppType) => app.id === newApp.id)) {
        window.toast.error(t('settings.miniapps.custom.duplicate_ids', { ids: newApp.id }))
        return
      }
      if (ORIGIN_DEFAULT_MIN_APPS.some((app: MinAppType) => app.id === newApp.id)) {
        window.toast.error(t('settings.miniapps.custom.conflicting_ids', { ids: newApp.id }))
        return
      }

      customApps.push(newApp)
      await window.api.file.writeWithId('custom-minapps.json', JSON.stringify(customApps, null, 2))
      window.toast.success(t('settings.miniapps.custom.save_success'))
      setModalVisible(false)
      setEditingApp(null)
      const reloadedApps = [...ORIGIN_DEFAULT_MIN_APPS, ...(await loadCustomMiniApp())]
      updateDefaultMinApps(reloadedApps)
      updateMinapps([...minapps, newApp])
    } catch (error) {
      window.toast.error(t('settings.miniapps.custom.save_error'))
      logger.error('Failed to save custom mini app:', error as Error)
    }
  }

  const handleEditCustomApp = async (updatedApp: MinAppType) => {
    try {
      const content = await window.api.file.read('custom-minapps.json')
      const customApps = JSON.parse(content)

      // Find and update the app
      const appIndex = customApps.findIndex((app: MinAppType) => app.id === updatedApp.id)
      if (appIndex === -1) {
        window.toast.error(t('settings.miniapps.custom.edit_error'))
        return
      }

      // Preserve addTime if it exists
      const existingApp = customApps[appIndex]
      customApps[appIndex] = {
        ...updatedApp,
        addTime: existingApp.addTime || updatedApp.addTime || new Date().toISOString()
      }

      await window.api.file.writeWithId('custom-minapps.json', JSON.stringify(customApps, null, 2))
      window.toast.success(t('settings.miniapps.custom.save_success'))
      setModalVisible(false)
      setEditingApp(null)
      const reloadedApps = [...ORIGIN_DEFAULT_MIN_APPS, ...(await loadCustomMiniApp())]
      updateDefaultMinApps(reloadedApps)
      // Update the minapps list
      const updatedMinapps = minapps.map((app) => (app.id === updatedApp.id ? updatedApp : app))
      updateMinapps(updatedMinapps)
    } catch (error) {
      window.toast.error(t('settings.miniapps.custom.edit_error'))
      logger.error('Failed to edit custom mini app:', error as Error)
    }
  }

  return (
    <Container onContextMenu={handleContextMenu}>
      <Navbar>
        <NavbarMain>
          {t('minapp.title')}
          <Input
            placeholder={t('common.search')}
            className="nodrag"
            style={{
              width: '30%',
              height: 28,
              borderRadius: 15
            }}
            size="small"
            variant="filled"
            suffix={<Search size={18} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button
            type="text"
            className="nodrag"
            icon={<SettingsIcon size={18} color="var(--color-text-2)" />}
            onClick={MinappSettingsPopup.show}
          />
        </NavbarMain>
      </Navbar>
      <ContentContainer id="content-container">
        <MainContainer>
          <RightContainer>
            {isTopNavbar && (
              <HeaderContainer>
                <Input
                  placeholder={t('common.search')}
                  className="nodrag"
                  style={{ width: '30%', borderRadius: 15 }}
                  variant="filled"
                  suffix={<Search size={18} />}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Button
                  type="text"
                  className="nodrag"
                  icon={<SettingsIcon size={18} color="var(--color-text-2)" />}
                  onClick={() => MinappSettingsPopup.show()}
                />
              </HeaderContainer>
            )}
            <AppsContainerWrapper>
              <AppsContainer style={{ height: containerHeight }}>
                {filteredApps.map((app) => (
                  <App key={app.id} app={app} onEdit={handleOpenEditModal} />
                ))}
                <AddButtonContainer
                  onClick={() => {
                    setEditingApp(null)
                    setModalVisible(true)
                  }}>
                  <AddButton>
                    <PlusOutlined />
                  </AddButton>
                  <AppTitle>{t('settings.miniapps.custom.title')}</AppTitle>
                </AddButtonContainer>
              </AppsContainer>
            </AppsContainerWrapper>
            <MiniAppFormModal
              mode={isEditMode ? 'edit' : 'create'}
              visible={modalVisible}
              initialValues={editingApp || undefined}
              onCancel={() => {
                setModalVisible(false)
                setEditingApp(null)
              }}
              onSubmit={isEditMode ? handleEditCustomApp : handleAddCustomApp}
            />
          </RightContainer>
        </MainContainer>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  justify-content: center;
  height: 100%;
`

const HeaderContainer = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  height: 60px;
  width: 100%;
  gap: 10px;
`

const MainContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  height: calc(100vh - var(--navbar-height));
  width: 100%;
`

const RightContainer = styled(Scrollbar)`
  display: flex;
  flex: 1 1 0%;
  min-width: 0;
  flex-direction: column;
  height: 100%;
  align-items: center;
  height: calc(100vh - var(--navbar-height));
`

const AppsContainerWrapper = styled(Scrollbar)`
  display: flex;
  flex: 1;
  flex-direction: row;
  justify-content: center;
  padding: 50px 0;
  width: 100%;
  margin-bottom: 20px;
  [navbar-position='top'] & {
    padding: 20px 0;
  }
`

const AppsContainer = styled.div`
  display: grid;
  min-width: 0;
  max-width: 930px;
  margin: 0 20px;
  width: 100%;
  grid-template-columns: repeat(auto-fill, 90px);
  gap: 25px;
  justify-content: center;
`

const AddButtonContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
`

const AddButton = styled.div`
  width: 60px;
  height: 60px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-background-soft);
  border: 1px dashed var(--color-border);
  color: var(--color-text-soft);
  font-size: 24px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--color-background);
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
`

const AppTitle = styled.div`
  font-size: 12px;
  margin-top: 5px;
  color: var(--color-text-soft);
  text-align: center;
  user-select: none;
  white-space: nowrap;
`

export default AppsPage
