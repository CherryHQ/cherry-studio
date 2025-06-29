import {
  CalendarOutlined,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  UserAddOutlined,
  UserDeleteOutlined,
  UserOutlined
} from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import MemoryService from '@renderer/services/MemoryService'
import {
  selectCurrentUserId,
  selectGlobalMemoryEnabled,
  setCurrentUserId,
  setGlobalMemoryEnabled
} from '@renderer/store/memory'
import { MemoryItem } from '@types'
import {
  Avatar,
  Button,
  Card,
  Dropdown,
  Empty,
  Form,
  Input,
  message,
  Modal,
  Pagination,
  Select,
  Space,
  Spin,
  Switch
} from 'antd'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Brain, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'
import styled from 'styled-components'

import MemoriesSettingsModal from './settings-modal'

dayjs.extend(relativeTime)

const DEFAULT_USER_ID = 'default-user'

const { Option } = Select
const { TextArea } = Input

interface AddMemoryModalProps {
  visible: boolean
  onCancel: () => void
  onAdd: (memory: string) => Promise<void>
}

interface EditMemoryModalProps {
  visible: boolean
  memory: MemoryItem | null
  onCancel: () => void
  onUpdate: (id: string, memory: string, metadata?: Record<string, any>) => Promise<void>
}

interface AddUserModalProps {
  visible: boolean
  onCancel: () => void
  onAdd: (userId: string) => void
  existingUsers: string[]
}

const AddMemoryModal: React.FC<AddMemoryModalProps> = ({ visible, onCancel, onAdd }) => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const { t } = useTranslation()

  const handleSubmit = async (values: { memory: string }) => {
    setLoading(true)
    try {
      await onAdd(values.memory)
      form.resetFields()
      onCancel()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title={
        <Space>
          <PlusOutlined style={{ color: 'var(--color-primary)' }} />
          <span>{t('memory.add_memory')}</span>
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      width={600}
      styles={{
        header: {
          borderBottom: '1px solid var(--color-border)',
          paddingBottom: 16
        },
        body: {
          paddingTop: 24
        }
      }}
      footer={[
        <Button key="cancel" size="large" onClick={onCancel}>
          {t('common.cancel')}
        </Button>,
        <Button key="submit" type="primary" size="large" loading={loading} onClick={() => form.submit()}>
          {t('common.add')}
        </Button>
      ]}>
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          label={t('memory.memory_content')}
          name="memory"
          rules={[{ required: true, message: t('memory.please_enter_memory') }]}>
          <TextArea
            rows={5}
            placeholder={t('memory.memory_placeholder')}
            style={{ fontSize: '15px', lineHeight: '1.6' }}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

const EditMemoryModal: React.FC<EditMemoryModalProps> = ({ visible, memory, onCancel, onUpdate }) => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const { t } = useTranslation()

  useEffect(() => {
    if (memory && visible) {
      form.setFieldsValue({
        memory: memory.memory
      })
    }
  }, [memory, visible, form])

  const handleSubmit = async (values: { memory: string }) => {
    if (!memory) return

    setLoading(true)
    try {
      await onUpdate(memory.id, values.memory)
      form.resetFields()
      onCancel()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title={
        <Space>
          <EditOutlined style={{ color: 'var(--color-primary)' }} />
          <span>{t('memory.edit_memory')}</span>
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      width={600}
      styles={{
        header: {
          borderBottom: '1px solid var(--color-border)',
          paddingBottom: 16
        },
        body: {
          paddingTop: 24
        }
      }}
      footer={[
        <Button key="cancel" size="large" onClick={onCancel}>
          {t('common.cancel')}
        </Button>,
        <Button key="submit" type="primary" size="large" loading={loading} onClick={() => form.submit()}>
          {t('common.save')}
        </Button>
      ]}>
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          label={t('memory.memory_content')}
          name="memory"
          rules={[{ required: true, message: t('memory.please_enter_memory') }]}>
          <TextArea
            rows={5}
            placeholder={t('memory.memory_placeholder')}
            style={{ fontSize: '15px', lineHeight: '1.6' }}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

const AddUserModal: React.FC<AddUserModalProps> = ({ visible, onCancel, onAdd, existingUsers }) => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const { t } = useTranslation()

  const handleSubmit = async (values: { userId: string }) => {
    setLoading(true)
    try {
      await onAdd(values.userId.trim())
      form.resetFields()
      onCancel()
    } finally {
      setLoading(false)
    }
  }

  const validateUserId = (_: any, value: string) => {
    if (!value || !value.trim()) {
      return Promise.reject(new Error(t('memory.user_id_required')))
    }
    const trimmedValue = value.trim()
    if (trimmedValue === DEFAULT_USER_ID) {
      return Promise.reject(new Error(t('memory.user_id_reserved')))
    }
    if (existingUsers.includes(trimmedValue)) {
      return Promise.reject(new Error(t('memory.user_id_exists')))
    }
    if (trimmedValue.length > 50) {
      return Promise.reject(new Error(t('memory.user_id_too_long')))
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedValue)) {
      return Promise.reject(new Error(t('memory.user_id_invalid_chars')))
    }
    return Promise.resolve()
  }

  return (
    <Modal
      title={
        <Space>
          <UserAddOutlined style={{ color: 'var(--color-primary)' }} />
          <span>{t('memory.add_user')}</span>
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      width={500}
      styles={{
        header: {
          borderBottom: '1px solid var(--color-border)',
          paddingBottom: 16
        },
        body: {
          paddingTop: 24
        }
      }}
      footer={[
        <Button key="cancel" size="large" onClick={onCancel}>
          {t('common.cancel')}
        </Button>,
        <Button key="submit" type="primary" size="large" loading={loading} onClick={() => form.submit()}>
          {t('common.add')}
        </Button>
      ]}>
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item label={t('memory.new_user_id')} name="userId" rules={[{ validator: validateUserId }]}>
          <Input
            placeholder={t('memory.new_user_id_placeholder')}
            maxLength={50}
            size="large"
            prefix={<UserOutlined />}
          />
        </Form.Item>
        <div
          style={{
            marginBottom: 16,
            fontSize: '13px',
            color: 'var(--color-text-secondary)',
            background: 'var(--color-background-soft)',
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid var(--color-border)'
          }}>
          {t('memory.user_id_rules')}
        </div>
      </Form>
    </Modal>
  )
}

const MemoriesPage = () => {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const currentUser = useSelector(selectCurrentUserId)
  const globalMemoryEnabled = useSelector(selectGlobalMemoryEnabled)

  const [allMemories, setAllMemories] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [debouncedSearchText, setDebouncedSearchText] = useState('')
  const [settingsModalVisible, setSettingsModalVisible] = useState(false)
  const [addMemoryModalVisible, setAddMemoryModalVisible] = useState(false)
  const [editingMemory, setEditingMemory] = useState<MemoryItem | null>(null)
  const [addUserModalVisible, setAddUserModalVisible] = useState(false)
  const [form] = Form.useForm()
  const [uniqueUsers, setUniqueUsers] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const memoryService = MemoryService.getInstance()

  // Utility functions
  const getUserDisplayName = (user: string) => {
    return user === DEFAULT_USER_ID ? t('memory.default_user') : user
  }

  const getUserAvatar = (user: string) => {
    return user === DEFAULT_USER_ID ? user.slice(0, 1).toUpperCase() : user.slice(0, 2).toUpperCase()
  }

  // Load unique users from database
  const loadUniqueUsers = useCallback(async () => {
    try {
      const usersList = await memoryService.getUsersList()
      const users = usersList.map((user) => user.userId)
      setUniqueUsers(users)
    } catch (error) {
      console.error('Failed to load users list:', error)
    }
  }, [memoryService])

  // Load memories function
  const loadMemories = useCallback(
    async (userId?: string) => {
      const targetUser = userId || currentUser
      console.log('Loading all memories for user:', targetUser)
      setLoading(true)
      try {
        // First, ensure the memory service is using the correct user
        memoryService.setCurrentUser(targetUser)

        // Load unique users efficiently from database
        await loadUniqueUsers()

        // Get all memories for current user context (load up to 10000)
        const result = await memoryService.list({ limit: 10000, offset: 0 })
        console.log('Loaded memories for user:', targetUser, 'count:', result.results?.length || 0)
        setAllMemories(result.results || [])
      } catch (error) {
        console.error('Failed to load memories:', error)
        message.error(t('memory.load_failed'))
      } finally {
        setLoading(false)
      }
    },
    [currentUser, memoryService, t, loadUniqueUsers]
  )

  // Sync memoryService with Redux store on mount and when currentUser changes
  useEffect(() => {
    console.log('useEffect triggered for currentUser:', currentUser)
    // Reset to first page when user changes
    setCurrentPage(1)
    loadMemories(currentUser)
  }, [currentUser, loadMemories])

  // Debounce search text
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchText(searchText)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchText])

  // Filter memories based on search criteria with debounced search
  const filteredMemories = useMemo(() => {
    return allMemories.filter((memory) => {
      // Search text filter
      if (debouncedSearchText && !memory.memory.toLowerCase().includes(debouncedSearchText.toLowerCase())) {
        return false
      }
      return true
    })
  }, [allMemories, debouncedSearchText])

  // Calculate paginated memories
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const paginatedMemories = filteredMemories.slice(startIndex, endIndex)

  const handleSearch = (value: string) => {
    setSearchText(value)
    // Reset to first page when searching
    setCurrentPage(1)
  }

  // Reset to first page when debounced search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearchText])

  const handlePageChange = (page: number, size?: number) => {
    setCurrentPage(page)
    if (size && size !== pageSize) {
      setPageSize(size)
    }
  }

  const handleAddMemory = async (memory: string) => {
    try {
      // The memory service will automatically use the current user from its state
      await memoryService.add(memory, {})
      message.success(t('memory.add_success'))
      // Go to first page to see the newly added memory
      setCurrentPage(1)
      await loadMemories(currentUser)
    } catch (error) {
      console.error('Failed to add memory:', error)
      message.error(t('memory.add_failed'))
    }
  }

  const handleDeleteMemory = async (id: string) => {
    try {
      await memoryService.delete(id)
      message.success(t('memory.delete_success'))
      // Reload all memories
      await loadMemories(currentUser)
    } catch (error) {
      console.error('Failed to delete memory:', error)
      message.error(t('memory.delete_failed'))
    }
  }

  const handleEditMemory = (memory: MemoryItem) => {
    setEditingMemory(memory)
  }

  const handleUpdateMemory = async (id: string, memory: string, metadata?: Record<string, any>) => {
    try {
      await memoryService.update(id, memory, metadata)
      message.success(t('memory.update_success'))
      setEditingMemory(null)
      // Reload all memories
      await loadMemories(currentUser)
    } catch (error) {
      console.error('Failed to update memory:', error)
      message.error(t('memory.update_failed'))
    }
  }

  const handleUserSwitch = async (userId: string) => {
    console.log('Switching to user:', userId)

    // First update Redux state
    dispatch(setCurrentUserId(userId))

    // Clear current memories to show loading state immediately
    setAllMemories([])

    // Reset pagination
    setCurrentPage(1)

    try {
      // Explicitly load memories for the new user
      await loadMemories(userId)

      message.success(
        t('memory.user_switched', { user: userId === DEFAULT_USER_ID ? t('memory.default_user') : userId })
      )
    } catch (error) {
      console.error('Failed to switch user:', error)
      message.error(t('memory.user_switch_failed'))
    }
  }

  const handleAddUser = async (userId: string) => {
    try {
      // Create the user by adding an initial memory with the userId
      // This implicitly creates the user in the system
      await memoryService.setCurrentUser(userId)
      await memoryService.add(t('memory.initial_memory_content'), { userId })

      // Refresh the users list from the database to persist the new user
      await loadUniqueUsers()

      // Switch to the newly created user
      await handleUserSwitch(userId)
      message.success(t('memory.user_created', { user: userId }))
      setAddUserModalVisible(false)
    } catch (error) {
      console.error('Failed to add user:', error)
      message.error(t('memory.add_user_failed'))
    }
  }

  const handleSettingsSubmit = async () => {
    setSettingsModalVisible(false)
    await memoryService.updateConfig()
  }

  const handleSettingsCancel = () => {
    setSettingsModalVisible(false)
    form.resetFields()
  }

  const handleResetMemories = async (userId: string) => {
    Modal.confirm({
      title: t('memory.reset_memories_confirm_title'),
      content: t('memory.reset_memories_confirm_content', { user: getUserDisplayName(userId) }),
      icon: <ExclamationCircleOutlined />,
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      okType: 'danger',
      onOk: async () => {
        try {
          await memoryService.deleteAllMemoriesForUser(userId)
          message.success(t('memory.memories_reset_success', { user: getUserDisplayName(userId) }))

          // Reload memories to show the empty state
          await loadMemories(currentUser)
        } catch (error) {
          console.error('Failed to reset memories:', error)
          message.error(t('memory.reset_memories_failed'))
        }
      }
    })
  }

  const handleDeleteUser = async (userId: string) => {
    if (userId === DEFAULT_USER_ID) {
      message.error(t('memory.cannot_delete_default_user'))
      return
    }

    Modal.confirm({
      title: t('memory.delete_user_confirm_title'),
      content: t('memory.delete_user_confirm_content', { user: userId }),
      icon: <ExclamationCircleOutlined />,
      okText: t('common.yes'),
      cancelText: t('common.no'),
      okType: 'danger',
      onOk: async () => {
        try {
          await memoryService.deleteUser(userId)
          message.success(t('memory.user_deleted', { user: userId }))

          // Refresh the users list from database after deletion
          await loadUniqueUsers()

          // Switch to default user if current user was deleted
          if (currentUser === userId) {
            await handleUserSwitch(DEFAULT_USER_ID)
          } else {
            await loadMemories(currentUser)
          }
        } catch (error) {
          console.error('Failed to delete user:', error)
          message.error(t('memory.delete_user_failed'))
        }
      }
    })
  }

  const handleGlobalMemoryToggle = (enabled: boolean) => {
    dispatch(setGlobalMemoryEnabled(enabled))
    message.success(
      enabled
        ? t('memory.global_memory_enabled', 'Global memory has been enabled')
        : t('memory.global_memory_disabled', 'Global memory has been disabled')
    )
  }

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('memory.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <SideNav>
          <SideNavScrollContainer>
            <SideNavContent>
              <div className="section-title">{t('memory.settings', 'Settings')}</div>

              <div className="global-memory-toggle">
                <span className="toggle-label">{t('memory.global_memory', 'Global Memory')}</span>
                <Switch checked={globalMemoryEnabled} onChange={handleGlobalMemoryToggle} size="small" />
              </div>

              <div className="section-title">{t('memory.user_management', 'User Management')}</div>

              <Select
                value={currentUser}
                onChange={handleUserSwitch}
                className="user-selector"
                placeholder={t('memory.select_user')}
                size="middle"
                dropdownRender={(menu) => (
                  <>
                    {menu}
                    <div style={{ padding: '8px 0', borderTop: '1px solid #f0f0f0' }}>
                      <Button
                        type="text"
                        icon={<UserAddOutlined />}
                        onClick={() => setAddUserModalVisible(true)}
                        style={{ width: '100%', textAlign: 'left' }}>
                        {t('memory.add_new_user')}
                      </Button>
                    </div>
                  </>
                )}>
                <Option value={DEFAULT_USER_ID}>
                  <Space>
                    <Avatar size={20} style={{ background: 'var(--color-primary)' }}>
                      {getUserAvatar(DEFAULT_USER_ID)}
                    </Avatar>
                    <span>{t('memory.default_user')}</span>
                  </Space>
                </Option>
                {uniqueUsers
                  .filter((user) => user !== DEFAULT_USER_ID)
                  .map((user) => (
                    <Option key={user} value={user}>
                      <Space>
                        <Avatar size={20} style={{ background: 'var(--color-primary)' }}>
                          {getUserAvatar(user)}
                        </Avatar>
                        <span>{user}</span>
                      </Space>
                    </Option>
                  ))}
              </Select>

              <div className="section-title">{t('memory.statistics', 'Statistics')}</div>

              <div className="stat-item">
                <UserOutlined className="stat-icon" />
                <span className="stat-text">{getUserDisplayName(currentUser)}</span>
              </div>

              <div className="stat-item">
                <Brain size={14} className="stat-icon" />
                <span className="stat-text">
                  {allMemories.length} {allMemories.length === 1 ? t('memory.memory') : t('memory.title')}
                </span>
              </div>

              <div className="stat-item">
                <Users size={14} className="stat-icon" />
                <span className="stat-text">
                  {uniqueUsers.length} {t('memory.users', 'Users')}
                </span>
              </div>

              <div className="section-title">{t('memory.search', 'Search')}</div>

              <Input.Search
                className="search-input"
                placeholder={t('memory.search_placeholder')}
                size="middle"
                value={searchText}
                onChange={(e) => handleSearch(e.target.value)}
                allowClear
              />

              <div className="actions-section">
                <Button
                  className="action-button primary-action"
                  icon={<PlusOutlined />}
                  onClick={() => setAddMemoryModalVisible(true)}>
                  {t('memory.add_memory')}
                </Button>

                <Button
                  className="action-button secondary-action"
                  icon={<SettingOutlined />}
                  onClick={() => setSettingsModalVisible(true)}>
                  {t('memory.settings', 'Settings')}
                </Button>

                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'refresh',
                        label: t('common.refresh'),
                        icon: <ReloadOutlined />,
                        onClick: () => loadMemories(currentUser)
                      },
                      {
                        key: 'divider-reset',
                        type: 'divider' as const
                      },
                      {
                        key: 'reset',
                        label: t('memory.reset_memories'),
                        icon: <DeleteOutlined />,
                        danger: true,
                        onClick: () => handleResetMemories(currentUser)
                      },
                      ...(currentUser !== DEFAULT_USER_ID
                        ? [
                            {
                              key: 'divider-1',
                              type: 'divider' as const
                            },
                            {
                              key: 'deleteUser',
                              label: t('memory.delete_user'),
                              icon: <UserDeleteOutlined />,
                              danger: true,
                              onClick: () => handleDeleteUser(currentUser)
                            }
                          ]
                        : [])
                    ]
                  }}
                  trigger={['click']}
                  placement="bottomRight">
                  <Button className="action-button secondary-action" icon={<MoreOutlined />}>
                    {t('common.more', 'More')}
                  </Button>
                </Dropdown>
              </div>
            </SideNavContent>
          </SideNavScrollContainer>
        </SideNav>

        {allMemories.length === 0 && !loading ? (
          <MainContent>
            <EmptyView>
              <Brain size={48} className="empty-icon" />
              <div className="empty-title">
                {allMemories.length === 0 ? t('memory.no_memories') : t('memory.no_matching_memories')}
              </div>
              <div className="empty-description">
                {allMemories.length === 0 ? t('memory.no_memories_description') : t('memory.try_different_filters')}
              </div>
              {allMemories.length === 0 && (
                <Button
                  type="primary"
                  size="large"
                  icon={<PlusOutlined />}
                  onClick={() => setAddMemoryModalVisible(true)}>
                  {t('memory.add_first_memory')}
                </Button>
              )}
            </EmptyView>
          </MainContent>
        ) : (
          <MainContent>
            {loading && (
              <div style={{ textAlign: 'center', padding: '60px 0' }}>
                <Spin size="large" />
                <div style={{ marginTop: 16, color: 'var(--color-text-secondary)', fontSize: 14 }}>
                  {t('memory.loading')}
                </div>
              </div>
            )}

            {!loading && filteredMemories.length === 0 && allMemories.length > 0 && (
              <Empty
                description={t('memory.no_matching_memories')}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ padding: '60px 0' }}
              />
            )}

            {paginatedMemories.map((memory) => (
              <MemoryCard key={memory.id}>
                <div className="memory-header">
                  <div className="memory-meta">
                    <CalendarOutlined />
                    <span>{memory.createdAt ? dayjs(memory.createdAt).fromNow() : '-'}</span>
                  </div>
                </div>
                <p className="memory-content">{memory.memory}</p>
                <div className="memory-actions">
                  <Button
                    className="quick-edit-btn"
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleEditMemory(memory)}
                  />
                  <Dropdown
                    menu={{
                      items: [
                        {
                          key: 'delete',
                          label: t('common.delete'),
                          icon: <DeleteOutlined />,
                          danger: true,
                          onClick: () => {
                            Modal.confirm({
                              title: t('memory.delete_confirm'),
                              content: t('memory.delete_confirm_single'),
                              onOk: () => handleDeleteMemory(memory.id),
                              okText: t('common.confirm'),
                              cancelText: t('common.cancel')
                            })
                          }
                        }
                      ]
                    }}
                    trigger={['click']}
                    placement="topRight">
                    <Button className="quick-edit-btn" type="text" size="small" icon={<MoreOutlined />} />
                  </Dropdown>
                </div>
              </MemoryCard>
            ))}

            {!loading && filteredMemories.length > 0 && (
              <PaginationContainer>
                <Pagination
                  current={currentPage}
                  pageSize={pageSize}
                  total={filteredMemories.length}
                  onChange={handlePageChange}
                  showSizeChanger
                  showTotal={(total, range) => `${range[0]}-${range[1]} of ${total} memories`}
                  pageSizeOptions={['20', '50', '100', '200']}
                  defaultPageSize={50}
                />
              </PaginationContainer>
            )}
          </MainContent>
        )}
      </ContentContainer>

      {/* Add Memory Modal */}
      <AddMemoryModal
        visible={addMemoryModalVisible}
        onCancel={() => setAddMemoryModalVisible(false)}
        onAdd={handleAddMemory}
      />

      {/* Edit Memory Modal */}
      <EditMemoryModal
        visible={!!editingMemory}
        memory={editingMemory}
        onCancel={() => setEditingMemory(null)}
        onUpdate={handleUpdateMemory}
      />

      {/* Add User Modal */}
      <AddUserModal
        visible={addUserModalVisible}
        onCancel={() => setAddUserModalVisible(false)}
        onAdd={handleAddUser}
        existingUsers={[...uniqueUsers, DEFAULT_USER_ID]}
      />

      {/* Settings Modal */}
      <MemoriesSettingsModal
        visible={settingsModalVisible}
        onSubmit={async () => await handleSettingsSubmit()}
        onCancel={handleSettingsCancel}
        form={form}
      />
    </Container>
  )
}

// Styled Components
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

const SideNav = styled.div`
  min-width: var(--settings-width);
  border-right: 0.5px solid var(--color-border);
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  background: var(--color-background);
`

const SideNavScrollContainer = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  flex: 1;

  > div {
    margin-bottom: 8px;

    &:last-child {
      margin-bottom: 0;
    }
  }
`

const SideNavContent = styled.div`
  padding: 16px 0;

  .section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 12px;
    padding: 0 8px;
  }

  .global-memory-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    background: var(--color-background-soft);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    margin-bottom: 20px;
    transition: all 0.2s ease;

    &:hover {
      background: var(--color-background-hover);
    }

    .toggle-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text);
    }
  }

  .user-selector {
    width: 100%;
    margin-bottom: 16px;

    .ant-select-selector {
      border-radius: 8px;
      background: var(--color-background-soft);
      border: 1px solid var(--color-border);
    }
  }

  .stat-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--color-background-soft);
    border-radius: 6px;
    margin-bottom: 8px;
    border: 1px solid var(--color-border);
    transition: all 0.2s ease;

    &:hover {
      background: var(--color-background-hover);
    }

    .stat-icon {
      font-size: 14px;
      color: var(--color-text-secondary);
    }

    .stat-text {
      font-size: 13px;
      color: var(--color-text);
    }
  }

  .actions-section {
    margin-top: 20px;

    .action-button {
      width: 100%;
      margin-bottom: 8px;
      border-radius: 6px;
      transition: all 0.2s ease;

      &.primary-action {
        background: var(--color-primary);
        border: none;

        &:hover {
          background: var(--color-primary-hover);
        }
      }

      &.secondary-action {
        background: var(--color-background-soft);
        border: 1px solid var(--color-border);
        color: var(--color-text);

        &:hover {
          background: var(--color-background-hover);
          border-color: var(--color-primary);
        }
      }
    }
  }

  .search-input {
    width: 100%;

    .ant-input {
      border-radius: 6px;
      background: var(--color-background-soft);
      border: 1px solid var(--color-border);
    }
  }
`

const MainContent = styled(Scrollbar)`
  padding: 15px 20px;
  display: flex;
  width: 100%;
  flex-direction: column;
  padding-bottom: 50px;
`

const MemoryCard = styled(Card)`
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  margin-bottom: 12px;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  position: relative;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    border-color: var(--color-primary);
    transform: translateY(-1px);
  }

  .ant-card-body {
    padding: 16px;
  }

  .memory-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
  }

  .memory-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--color-text-tertiary);
    font-size: 11px;
    font-weight: 500;
  }

  .memory-content {
    color: var(--color-text);
    font-size: 14px;
    line-height: 1.5;
    margin: 0;
    word-break: break-word;
  }

  .memory-actions {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.2s ease;
    background: var(--color-background-soft);
    padding: 2px;
    border-radius: 6px;
    border: 1px solid var(--color-border);
  }

  &:hover .memory-actions {
    opacity: 1;
  }

  .quick-edit-btn {
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    transition: color 0.2s ease;
    width: 24px;
    height: 24px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      color: var(--color-primary);
      background: rgba(var(--color-primary-rgb), 0.1);
    }
  }
`

const EmptyView = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;

  .empty-icon {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.6;
  }

  .empty-title {
    color: var(--color-text);
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .empty-description {
    color: var(--color-text-secondary);
    font-size: 14px;
    margin-bottom: 24px;
    max-width: 300px;
  }
`

const PaginationContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 20px;
  padding: 16px 0;

  .ant-pagination {
    font-size: 13px;
  }

  .ant-pagination-item-active {
    background-color: var(--color-primary);
    border-color: var(--color-primary);

    a {
      color: white;
    }
  }
`

export default MemoriesPage
