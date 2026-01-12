import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import ListItem from '@renderer/components/ListItem'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { useKnowledgeBases } from '@renderer/data/hooks/useKnowledges'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useAssistantPresets } from '@renderer/hooks/useAssistantPresets'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import KnowledgeSearchPopup from '@renderer/pages/knowledge/components/KnowledgeSearchPopup'
import type { KnowledgeBase as KnowledgeBaseV1 } from '@renderer/types'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { MenuProps } from 'antd'
import { Dropdown, Empty } from 'antd'
import { Book, Plus, Settings } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AddKnowledgeBasePopup from './components/AddKnowledgeBasePopup'
import EditKnowledgeBasePopup from './components/EditKnowledgeBasePopup'
import KnowledgeContent from './KnowledgeContent'

const KnowledgePage: FC = () => {
  const { t } = useTranslation()
  const { bases, renameKnowledgeBase, deleteKnowledgeBase } = useKnowledgeBases()
  const { assistants, updateAssistants } = useAssistants()
  const { presets, setAssistantPresets } = useAssistantPresets()
  // Note: During migration, child components still expect v1 KnowledgeBase type
  // The v2 bases have a different structure but contain compatible core fields (id, name)
  // Child components will be migrated separately
  const [selectedBase, setSelectedBase] = useState<KnowledgeBase | undefined>(bases[0])

  const handleAddKnowledge = useCallback(async () => {
    const newBase = await AddKnowledgeBasePopup.show({ title: t('knowledge.add.title') })
    if (newBase) {
      // AddKnowledgeBasePopup returns v1 type but we use v2 - cast for compatibility
      setSelectedBase(newBase as unknown as KnowledgeBase)
    }
  }, [t])

  const handleEditKnowledgeBase = useCallback(async (base: KnowledgeBase) => {
    // EditKnowledgeBasePopup expects v1 type
    const newBase = await EditKnowledgeBasePopup.show({ base: base as unknown as KnowledgeBaseV1 })
    if (newBase && newBase?.id !== base.id) {
      setSelectedBase(newBase as unknown as KnowledgeBase)
    }
  }, [])

  useEffect(() => {
    const hasSelectedBase = bases.find((base) => base.id === selectedBase?.id)
    !hasSelectedBase && setSelectedBase(bases[0])
  }, [bases, selectedBase])

  const getMenuItems = useCallback(
    (base: KnowledgeBase) => {
      const menus: MenuProps['items'] = [
        {
          label: t('knowledge.rename'),
          key: 'rename',
          icon: <EditIcon size={14} />,
          async onClick() {
            const name = await PromptPopup.show({
              title: t('knowledge.rename'),
              message: '',
              defaultValue: base.name || ''
            })
            if (name && base.name !== name) {
              renameKnowledgeBase(base.id, name)
            }
          }
        },
        {
          label: t('common.settings'),
          key: 'settings',
          icon: <Settings size={14} />,
          onClick: () => handleEditKnowledgeBase(base)
        },
        { type: 'divider' },
        {
          label: t('common.delete'),
          danger: true,
          key: 'delete',
          icon: <DeleteIcon size={14} className="lucide-custom" />,
          onClick: () => {
            window.modal.confirm({
              title: t('knowledge.delete_confirm'),
              centered: true,
              onOk: async () => {
                setSelectedBase(undefined)
                await deleteKnowledgeBase(base.id)

                // Clean up assistant references
                const updatedAssistants = assistants.map((assistant) => ({
                  ...assistant,
                  knowledge_bases: assistant.knowledge_bases?.filter((kb) => kb.id !== base.id)
                }))
                updateAssistants(updatedAssistants)

                // Clean up preset references
                const updatedPresets = presets.map((preset) => ({
                  ...preset,
                  knowledge_bases: preset.knowledge_bases?.filter((kb) => kb.id !== base.id)
                }))
                setAssistantPresets(updatedPresets)
              }
            })
          }
        }
      ]

      return menus
    },
    [
      assistants,
      deleteKnowledgeBase,
      handleEditKnowledgeBase,
      presets,
      renameKnowledgeBase,
      setAssistantPresets,
      t,
      updateAssistants
    ]
  )

  useShortcut('search_message', () => {
    if (selectedBase) {
      // KnowledgeSearchPopup expects v1 type
      KnowledgeSearchPopup.show({ base: selectedBase as unknown as KnowledgeBaseV1 }).then()
    }
  })

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('knowledge.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <KnowledgeSideNav>
          {bases.map((base) => (
            <Dropdown menu={{ items: getMenuItems(base) }} trigger={['contextMenu']} key={base.id}>
              <div>
                <ListItem
                  active={selectedBase?.id === base.id}
                  icon={<Book size={16} />}
                  title={base.name}
                  onClick={() => setSelectedBase(base)}
                />
              </div>
            </Dropdown>
          ))}
          <AddKnowledgeItem onClick={handleAddKnowledge}>
            <AddKnowledgeName>
              <Plus size={18} />
              {t('button.add')}
            </AddKnowledgeName>
          </AddKnowledgeItem>
          <div style={{ minHeight: '10px' }}></div>
        </KnowledgeSideNav>
        {bases.length === 0 ? (
          <MainContent>
            <Empty description={t('knowledge.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </MainContent>
        ) : selectedBase ? (
          // KnowledgeContent expects v1 type - will be migrated separately
          <KnowledgeContent selectedBase={selectedBase as unknown as KnowledgeBaseV1} />
        ) : null}
      </ContentContainer>
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

const KnowledgeSideNav = styled(Scrollbar)`
  display: flex;
  flex-direction: column;

  width: calc(var(--settings-width) + 100px);
  border-right: 0.5px solid var(--color-border);
  padding: 12px 10px;

  .ant-menu {
    border-inline-end: none !important;
    background: transparent;
    flex: 1;
  }

  .ant-menu-item {
    height: 40px;
    line-height: 40px;
    margin: 4px 0;
    width: 100%;

    &:hover {
      background-color: var(--color-background-soft);
    }

    &.ant-menu-item-selected {
      background-color: var(--color-background-soft);
      color: var(--color-primary);
    }
  }

  > div {
    margin-bottom: 8px;

    &:last-child {
      margin-bottom: 0;
    }
  }
`

const AddKnowledgeItem = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 7px 12px;
  position: relative;
  border-radius: var(--list-item-border-radius);
  border: 0.5px solid transparent;
  cursor: pointer;
  &:hover {
    background-color: var(--color-background-soft);
  }
`

const AddKnowledgeName = styled.div`
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
`

export default KnowledgePage
