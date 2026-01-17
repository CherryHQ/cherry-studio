import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { Empty } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AddKnowledgeBaseDialog from './components/AddKnowledgeBaseDialog'
import EditKnowledgeBaseDialog from './components/EditKnowledgeBaseDialog'
import KnowledgeSearchDialog from './components/KnowledgeSearchDialog'
import KnowledgeSideNav from './components/KnowledgeSideNav'
import { useKnowledgeBaseSelection } from './hooks/useKnowledgeBaseSelection'
import KnowledgeContent from './KnowledgeContent'

const KnowledgePage: FC = () => {
  const { t } = useTranslation()
  const {
    bases,
    selectedBaseId,
    selectBase,
    handleAddKnowledgeBase,
    deleteKnowledgeBase,
    // Dialog states and handlers
    addDialogOpen,
    setAddDialogOpen,
    editDialogOpen,
    editingBaseId,
    handleAddSuccess,
    handleEditSuccess,
    handleEditDialogClose
  } = useKnowledgeBaseSelection()

  // Search dialog state
  const [searchDialogOpen, setSearchDialogOpen] = useState(false)

  useShortcut('search_message', () => {
    if (selectedBaseId) {
      setSearchDialogOpen(true)
    }
  })

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('knowledge.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <KnowledgeSideNav
          bases={bases}
          selectedBaseId={selectedBaseId}
          onSelect={selectBase}
          onAdd={handleAddKnowledgeBase}
          deleteKnowledgeBase={deleteKnowledgeBase}
        />
        {bases.length === 0 ? (
          <MainContent>
            <Empty description={t('knowledge.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </MainContent>
        ) : selectedBaseId ? (
          <KnowledgeContent selectedBaseId={selectedBaseId} />
        ) : null}
      </ContentContainer>

      {/* Dialogs */}
      <AddKnowledgeBaseDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} onSuccess={handleAddSuccess} />
      {editingBaseId && (
        <EditKnowledgeBaseDialog
          baseId={editingBaseId}
          open={editDialogOpen}
          onOpenChange={handleEditDialogClose}
          onSuccess={handleEditSuccess}
        />
      )}
      {selectedBaseId && (
        <KnowledgeSearchDialog baseId={selectedBaseId} open={searchDialogOpen} onOpenChange={setSearchDialogOpen} />
      )}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: calc(100vh - var(--navbar-height));
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  min-height: 100%;
`

const MainContent = styled(Scrollbar)`
  padding: 15px 20px;
  display: flex;
  width: 100%;
  flex-direction: column;
  padding-bottom: 50px;
`

export default KnowledgePage
