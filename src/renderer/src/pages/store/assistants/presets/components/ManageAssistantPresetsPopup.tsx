import { MenuOutlined } from '@ant-design/icons'
import { DraggableList } from '@renderer/components/DraggableList'
import { DeleteIcon } from '@renderer/components/Icons'
import { Box, HStack } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { useAssistantPresets } from '@renderer/hooks/useAssistantPresets'
import type { AssistantPreset } from '@renderer/types'
import { Button, Checkbox, Empty, Modal, Segmented } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type Mode = 'sort' | 'delete'

const PopupContainer: React.FC = () => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const { presets, setAssistantPresets } = useAssistantPresets()
  const [mode, setMode] = useState<Mode>('sort')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = async () => {
    ManageAssistantPresetsPopup.hide()
  }

  const handleModeChange = (value: Mode) => {
    setMode(value)
    setSelectedIds(new Set())
  }

  const handleSelectAll = () => {
    if (selectedIds.size === presets.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(presets.map((p) => p.id)))
    }
  }

  const handleSelectNext100 = () => {
    const unselectedPresets = presets.filter((p) => !selectedIds.has(p.id))
    const next100 = unselectedPresets.slice(0, 100)
    const newSelected = new Set(selectedIds)
    next100.forEach((p) => newSelected.add(p.id))
    setSelectedIds(newSelected)
  }

  const handleSelect = (preset: AssistantPreset) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(preset.id)) {
      newSelected.delete(preset.id)
    } else {
      newSelected.add(preset.id)
    }
    setSelectedIds(newSelected)
  }

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return

    window.modal.confirm({
      centered: true,
      content: t('assistants.presets.manage.batch_delete.confirm', { count: selectedIds.size }),
      onOk: () => {
        const remainingPresets = presets.filter((p) => !selectedIds.has(p.id))
        setAssistantPresets(remainingPresets)
        setSelectedIds(new Set())
      }
    })
  }

  const isAllSelected = presets.length > 0 && selectedIds.size === presets.length
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < presets.length

  return (
    <Modal
      title={t('assistants.presets.manage.title')}
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      footer={null}
      transitionName="animation-move-down"
      centered>
      <Container>
        {presets.length > 0 && (
          <>
            <ActionBar>
              {mode === 'delete' ? (
                <HStack alignItems="center">
                  <Checkbox checked={isAllSelected} indeterminate={isIndeterminate} onChange={handleSelectAll}>
                    {t('common.select_all')}
                  </Checkbox>
                  {presets.length > 100 && selectedIds.size < presets.length && (
                    <Button type="link" size="small" onClick={handleSelectNext100} style={{ padding: 0 }}>
                      +100
                    </Button>
                  )}
                </HStack>
              ) : (
                <div />
              )}
              <HStack gap="8px" alignItems="center">
                {mode === 'delete' && (
                  <Button
                    danger
                    type="text"
                    icon={<DeleteIcon size={14} />}
                    disabled={selectedIds.size === 0}
                    onClick={handleBatchDelete}>
                    {t('assistants.presets.manage.batch_delete.button')} ({selectedIds.size})
                  </Button>
                )}
                <Segmented
                  size="small"
                  value={mode}
                  onChange={(value) => handleModeChange(value as Mode)}
                  options={[
                    { label: t('assistants.presets.manage.mode.sort'), value: 'sort' },
                    { label: t('assistants.presets.manage.mode.delete'), value: 'delete' }
                  ]}
                />
              </HStack>
            </ActionBar>

            {mode === 'sort' ? (
              <AgentList>
                <DraggableList list={presets} onUpdate={setAssistantPresets}>
                  {(item) => (
                    <AgentItem>
                      <Box mr={8}>
                        {item.emoji} {item.name}
                      </Box>
                      <HStack gap="15px">
                        <MenuOutlined style={{ cursor: 'move' }} />
                      </HStack>
                    </AgentItem>
                  )}
                </DraggableList>
              </AgentList>
            ) : (
              <AgentList>
                {presets.map((item) => (
                  <SelectableAgentItem
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    $selected={selectedIds.has(item.id)}>
                    <HStack alignItems="center" gap="8px">
                      <Checkbox checked={selectedIds.has(item.id)} onChange={() => handleSelect(item)} />
                      <Box>
                        {item.emoji} {item.name}
                      </Box>
                    </HStack>
                  </SelectableAgentItem>
                ))}
              </AgentList>
            )}
          </>
        )}
        {presets.length === 0 && <Empty description="" />}
      </Container>
    </Modal>
  )
}

const Container = styled.div`
  padding: 12px 0;
  height: 50vh;
  display: flex;
  flex-direction: column;
`

const ActionBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 12px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 12px;
`

const AgentList = styled.div`
  flex: 1;
  overflow-y: auto;
  &::-webkit-scrollbar {
    display: none;
  }
`

const AgentItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  border-radius: 8px;
  user-select: none;
  background-color: var(--color-background-soft);
  margin-bottom: 8px;
  .anticon {
    font-size: 16px;
    color: var(--color-icon);
  }
  &:hover {
    background-color: var(--color-background-mute);
  }
`

const SelectableAgentItem = styled.div<{ $selected: boolean }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  border-radius: 8px;
  user-select: none;
  background-color: ${(props) => (props.$selected ? 'var(--color-primary-mute)' : 'var(--color-background-soft)')};
  margin-bottom: 8px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  &:hover {
    background-color: ${(props) => (props.$selected ? 'var(--color-primary-mute)' : 'var(--color-background-mute)')};
  }
`

export default class ManageAssistantPresetsPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('ManageAssistantPresetsPopup')
  }
  static show() {
    TopView.show(<PopupContainer />, 'ManageAssistantPresetsPopup')
  }
}
