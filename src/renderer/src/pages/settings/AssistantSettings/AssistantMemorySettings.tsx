import { InfoCircleOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { Box } from '@renderer/components/Layout'
import MemoriesSettingsModal from '@renderer/pages/memory/settings-modal'
import MemoryService from '@renderer/services/MemoryService'
import { selectCurrentUserId, selectGlobalMemoryEnabled, selectMemoryConfig } from '@renderer/store/memory'
import { Assistant, AssistantSettings } from '@renderer/types'
import { Alert, Button, Card, Select, Space, Switch, Tooltip, Typography } from 'antd'
import { useForm } from 'antd/es/form/Form'
import { Settings2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

const logger = loggerService.withContext('AssistantMemorySettings')

const { Text } = Typography

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings: (settings: AssistantSettings) => void
  onClose?: () => void // Add optional close callback
}

const AssistantMemorySettings: React.FC<Props> = ({ assistant, updateAssistant, onClose }) => {
  const { t } = useTranslation()
  const memoryConfig = useSelector(selectMemoryConfig)
  const globalMemoryEnabled = useSelector(selectGlobalMemoryEnabled)
  const currentUserId = useSelector(selectCurrentUserId)
  const [memoryStats, setMemoryStats] = useState<{ count: number; loading: boolean }>({
    count: 0,
    loading: true
  })
  const [availableUsers, setAvailableUsers] = useState<
    { userId: string; memoryCount: number; lastMemoryDate: string }[]
  >([])
  const [settingsModalVisible, setSettingsModalVisible] = useState(false)
  const memoryService = MemoryService.getInstance()
  const form = useForm()

  // Load available memory users
  const loadUsers = useCallback(async () => {
    try {
      const users = await memoryService.getUsersList()
      setAvailableUsers(users)
    } catch (error) {
      logger.error('Failed to load memory users:', error as Error)
      setAvailableUsers([])
    }
  }, [memoryService])

  // Load memory statistics for this assistant
  const loadMemoryStats = useCallback(async () => {
    setMemoryStats((prev) => ({ ...prev, loading: true }))
    try {
      const effectiveUserId = memoryService.getEffectiveUserId(assistant, currentUserId)
      const result = await memoryService.list({
        userId: effectiveUserId,
        agentId: assistant.id,
        limit: 1000
      })
      setMemoryStats({ count: result.results.length, loading: false })
    } catch (error) {
      logger.error('Failed to load memory stats:', error as Error)
      setMemoryStats({ count: 0, loading: false })
    }
  }, [assistant, currentUserId, memoryService])

  useEffect(() => {
    loadUsers()
    loadMemoryStats()
  }, [loadUsers, loadMemoryStats])

  const handleMemoryToggle = (enabled: boolean) => {
    updateAssistant({ ...assistant, enableMemory: enabled })
  }

  const handleMemoryUserChange = (value: string) => {
    // 'global' means use global default (undefined)
    const memoryUserId = value === 'global' ? undefined : value
    updateAssistant({ ...assistant, memoryUserId })
    // Reload stats after changing user
    setTimeout(() => loadMemoryStats(), 100)
  }

  const handleNavigateToMemory = () => {
    // Close current modal/page first
    if (onClose) {
      onClose()
    }
    // Then navigate to memory settings page
    window.location.hash = '#/settings/memory'
  }

  const isMemoryConfigured = memoryConfig.embedderApiClient && memoryConfig.llmApiClient
  const isMemoryEnabled = globalMemoryEnabled && isMemoryConfigured
  const effectiveUserId = memoryService.getEffectiveUserId(assistant, currentUserId)
  const currentMemoryUser = assistant.memoryUserId || 'global'

  return (
    <Container>
      <HeaderContainer>
        <Box style={{ fontWeight: 'bold', fontSize: '14px' }}>
          {t('memory.title')}
          <Tooltip title={t('memory.description')}>
            <InfoIcon />
          </Tooltip>
        </Box>
        <Space>
          <Button type="text" icon={<Settings2 size={15} />} onClick={handleNavigateToMemory} />
          <Tooltip
            title={
              !globalMemoryEnabled
                ? t('memory.enable_global_memory_first')
                : !isMemoryConfigured
                  ? t('memory.configure_memory_first')
                  : ''
            }>
            <Switch
              checked={assistant.enableMemory || false}
              onChange={handleMemoryToggle}
              disabled={!isMemoryEnabled}
            />
          </Tooltip>
        </Space>
      </HeaderContainer>

      {!globalMemoryEnabled && (
        <Alert
          type="warning"
          message={t('memory.global_memory_disabled_title')}
          description={t('memory.global_memory_disabled_desc')}
          showIcon
          style={{ marginBottom: 16 }}
          action={
            <Button size="small" onClick={handleNavigateToMemory}>
              {t('memory.go_to_memory_page')}
            </Button>
          }
        />
      )}

      {globalMemoryEnabled && !isMemoryConfigured && (
        <Alert
          type="warning"
          message={t('memory.not_configured_title')}
          description={t('memory.not_configured_desc')}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Memory User Selection */}
      {assistant.enableMemory && isMemoryEnabled && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <Text strong>{t('memory.active_memory_user')}: </Text>
              <Select
                value={currentMemoryUser}
                onChange={handleMemoryUserChange}
                style={{ width: 200, marginLeft: 8 }}
                disabled={!assistant.enableMemory}>
                <Select.Option value="global">
                  {t('memory.default_user')} ({currentUserId})
                </Select.Option>
                {availableUsers.map((user) => (
                  <Select.Option key={user.userId} value={user.userId}>
                    {user.userId} ({user.memoryCount} memories)
                  </Select.Option>
                ))}
              </Select>
            </div>
          </Space>
        </Card>
      )}

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Text strong>{t('memory.stored_memories')}: </Text>
            <Text>{memoryStats.loading ? t('common.loading') : memoryStats.count}</Text>
          </div>
          <div>
            <Text strong>{t('memory.active_memory_user')}: </Text>
            <Text code>{effectiveUserId}</Text>
          </div>
          {memoryConfig.embedderApiClient && (
            <div>
              <Text strong>{t('memory.embedding_model')}: </Text>
              <Text code>{memoryConfig.embedderApiClient.model}</Text>
            </div>
          )}
          {memoryConfig.llmApiClient && (
            <div>
              <Text strong>{t('memory.llm_model')}: </Text>
              <Text code>{memoryConfig.llmApiClient.model}</Text>
            </div>
          )}
        </Space>
      </Card>

      <MemoriesSettingsModal
        visible={settingsModalVisible}
        onSubmit={() => setSettingsModalVisible(false)}
        onCancel={() => setSettingsModalVisible(false)}
        form={form}
      />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
`

const HeaderContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`

const InfoIcon = styled(InfoCircleOutlined)`
  margin-left: 6px;
  font-size: 14px;
  color: var(--color-text-2);
  cursor: help;
`

export default AssistantMemorySettings
