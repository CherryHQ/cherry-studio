import {
  AppstoreOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { TopicManager } from '@renderer/hooks/useTopic'
import { analyzeAndAddShortMemories, useMemoryService } from '@renderer/services/MemoryService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addMemory,
  clearMemories,
  deleteMemory,
  editMemory,
  setAnalyzeModel,
  setAnalyzing,
  setAutoAnalyze,
  setMemoryActive,
  setShortMemoryAnalyzeModel
} from '@renderer/store/memory'
import { Topic } from '@renderer/types'
import { Button, Empty, Input, List, message, Modal, Radio, Select, Switch, Tabs, Tag, Tooltip } from 'antd'
import { FC, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  SettingContainer,
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '..'
import CollapsibleShortMemoryManager from './CollapsibleShortMemoryManager'
import MemoryDeduplicationPanel from './MemoryDeduplicationPanel'
import MemoryListManager from './MemoryListManager'
import MemoryMindMap from './MemoryMindMap'
import PriorityManagementSettings from './PriorityManagementSettings'

const MemorySettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const { analyzeAndAddMemories } = useMemoryService()

  // 从 Redux 获取记忆状态
  const memories = useAppSelector((state) => state.memory?.memories || [])
  const memoryLists = useAppSelector((state) => state.memory?.memoryLists || [])
  const currentListId = useAppSelector((state) => state.memory?.currentListId || null)
  const isActive = useAppSelector((state) => state.memory?.isActive || false)
  const autoAnalyze = useAppSelector((state) => state.memory?.autoAnalyze || false)
  const analyzeModel = useAppSelector((state) => state.memory?.analyzeModel || null)
  const shortMemoryAnalyzeModel = useAppSelector((state) => state.memory?.shortMemoryAnalyzeModel || null)
  const isAnalyzing = useAppSelector((state) => state.memory?.isAnalyzing || false)

  // 从 Redux 获取所有模型，不仅仅是可用的模型
  const providers = useAppSelector((state) => state.llm?.providers || [])

  // 使用 useMemo 缓存模型数组，避免不必要的重新渲染
  const models = useMemo(() => {
    // 只获取已启用的提供商的模型
    return providers
      .filter(provider => provider.enabled) // 只保留已启用的提供商
      .flatMap((provider) => provider.models || [])
  }, [providers])

  // 使用 useMemo 缓存模型选项数组，避免不必要的重新渲染
  const modelOptions = useMemo(() => {
    if (models.length > 0) {
      // 按提供商分组模型
      const modelsByProvider = models.reduce(
        (acc, model) => {
          const provider = providers.find((p) => p.models.some((m) => m.id === model.id))
          const providerName = provider ? (provider.isSystem ? t(`provider.${provider.id}`) : provider.name) : ''

          if (!acc[providerName]) {
            acc[providerName] = []
          }

          // 检查是否已经存在相同的模型，避免重复
          const isDuplicate = acc[providerName].some((m) => m.value === model.id)
          if (!isDuplicate) {
            acc[providerName].push({
              label: `${model.name}`,
              value: model.id
            })
          }

          return acc
        },
        {} as Record<string, { label: string; value: string }[]>
      )

      // 转换为Select组件的options格式
      const groupedOptions = Object.entries(modelsByProvider).map(([provider, models]) => ({
        label: provider,
        options: models
      }))

      // 将分组选项展平为单个选项数组，以兼容现有代码
      const flatOptions = models.reduce(
        (acc, model) => {
          // 检查是否已经存在相同的模型，避免重复
          const isDuplicate = acc.some((m) => m.value === model.id)
          if (!isDuplicate) {
            acc.push({
              label: model.name,
              value: model.id
            })
          }
          return acc
        },
        [] as { label: string; value: string }[]
      )

      return {
        groupedOptions,
        flatOptions
      }
    } else {
      const defaultOptions = [
        // 默认模型选项
        { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
        { label: 'GPT-4', value: 'gpt-4' },
        { label: 'Claude 3 Opus', value: 'claude-3-opus-20240229' },
        { label: 'Claude 3 Sonnet', value: 'claude-3-sonnet-20240229' },
        { label: 'Claude 3 Haiku', value: 'claude-3-haiku-20240307' }
      ]
      return {
        groupedOptions: [],
        flatOptions: defaultOptions
      }
    }
  }, [models, providers, t])

  // 如果没有模型，添加一个默认模型
  useEffect(() => {
    if (models.length === 0 && !analyzeModel) {
      // 设置一个默认模型 ID
      dispatch(setAnalyzeModel('gpt-3.5-turbo'))
    }
  }, [models, analyzeModel, dispatch])

  // 获取助手列表，用于话题信息补充
  const assistants = useAppSelector((state) => state.assistants?.assistants || [])

  // 加载所有话题
  useEffect(() => {
    const loadTopics = async () => {
      try {
        // 从数据库获取所有话题
        const allTopics = await TopicManager.getAllTopics()
        if (allTopics && allTopics.length > 0) {
          // 获取话题的完整信息
          const fullTopics = allTopics.map((dbTopic) => {
            // 尝试从 Redux 中找到完整的话题信息
            for (const assistant of assistants) {
              if (assistant.topics) {
                const topic = assistant.topics.find((t) => t.id === dbTopic.id)
                if (topic) return topic
              }
            }
            // 如果找不到，返回一个基本的话题对象
            return {
              id: dbTopic.id,
              assistantId: '',
              name: `话题 ${dbTopic.id.substring(0, 8)}`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              messages: dbTopic.messages || []
            }
          })

          // 按更新时间排序，最新的在前
          const sortedTopics = fullTopics.sort((a, b) => {
            return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
          })
          setTopics(sortedTopics)
        }
      } catch (error) {
        console.error('Failed to load topics:', error)
      }
    }

    loadTopics()
  }, [assistants])

  // 本地状态
  const [isAddModalVisible, setIsAddModalVisible] = useState(false)
  const [isEditModalVisible, setIsEditModalVisible] = useState(false)
  const [isClearModalVisible, setIsClearModalVisible] = useState(false)
  const [newMemory, setNewMemory] = useState('')
  const [editingMemory, setEditingMemory] = useState<{ id: string; content: string } | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'mindmap'>('list')
  const [topics, setTopics] = useState<Topic[]>([])
  const [selectedTopicId, setSelectedTopicId] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  // 处理添加记忆
  const handleAddMemory = () => {
    if (newMemory.trim()) {
      dispatch(
        addMemory({
          content: newMemory.trim(),
          listId: currentListId || undefined
        })
      )
      setNewMemory('')
      setIsAddModalVisible(false)
      message.success(t('settings.memory.addSuccess'))
    }
  }

  // 处理编辑记忆
  const handleEditMemory = () => {
    if (editingMemory && editingMemory.content.trim()) {
      dispatch(
        editMemory({
          id: editingMemory.id,
          content: editingMemory.content.trim()
        })
      )
      setEditingMemory(null)
      setIsEditModalVisible(false)
      message.success(t('settings.memory.editSuccess'))
    }
  }

  // 处理删除记忆
  const handleDeleteMemory = (id: string) => {
    dispatch(deleteMemory(id))
    message.success(t('settings.memory.deleteSuccess'))
  }

  // 处理清空记忆
  const handleClearMemories = () => {
    dispatch(clearMemories(currentListId || undefined))
    setIsClearModalVisible(false)
    message.success(t('settings.memory.clearSuccess'))
  }

  // 处理切换记忆功能
  const handleToggleMemory = (checked: boolean) => {
    dispatch(setMemoryActive(checked))
  }

  // 处理切换自动分析
  const handleToggleAutoAnalyze = (checked: boolean) => {
    dispatch(setAutoAnalyze(checked))
  }

  // 处理选择长期记忆分析模型
  const handleSelectModel = (modelId: string) => {
    dispatch(setAnalyzeModel(modelId))
  }

  // 处理选择短期记忆分析模型
  const handleSelectShortMemoryModel = (modelId: string) => {
    dispatch(setShortMemoryAnalyzeModel(modelId))
  }

  // 手动触发分析
  const handleManualAnalyze = async (isShortMemory: boolean = false) => {
    if (!isActive) {
      message.warning(t('settings.memory.cannotAnalyze') || '无法分析，请检查设置')
      return
    }

    // 如果没有选择话题，提示用户
    if (!selectedTopicId) {
      message.warning(t('settings.memory.selectTopicFirst') || '请先选择要分析的话题')
      return
    }

    message.info(t('settings.memory.startingAnalysis') || '开始分析...')

    if (isShortMemory) {
      // 短期记忆分析
      if (!shortMemoryAnalyzeModel) {
        message.warning(t('settings.memory.noShortMemoryModel') || '未设置短期记忆分析模型')
        return
      }

      try {
        // 调用短期记忆分析函数
        const result = await analyzeAndAddShortMemories(selectedTopicId)

        if (result) {
          message.success(t('settings.memory.shortMemoryAnalysisSuccess') || '短期记忆分析成功')
        } else {
          message.info(t('settings.memory.shortMemoryAnalysisNoNew') || '未发现新的短期记忆')
        }
      } catch (error) {
        console.error('Failed to analyze short memories:', error)
        message.error(t('settings.memory.shortMemoryAnalysisError') || '短期记忆分析失败')
      }
    } else {
      // 长期记忆分析
      if (!analyzeModel) {
        message.warning(t('settings.memory.noAnalyzeModel') || '未设置长期记忆分析模型')
        return
      }

      // 调用长期记忆分析函数
      analyzeAndAddMemories(selectedTopicId)
    }
  }

  // 重置分析状态
  const handleResetAnalyzingState = () => {
    dispatch(setAnalyzing(false))
    message.success(t('settings.memory.resetAnalyzingState') || '分析状态已重置')
  }

  // 添加滚动检测
  const containerRef = useRef<HTMLDivElement>(null)
  const listContainerRef = useRef<HTMLDivElement>(null)

  // 检测滚动状态并添加类
  useEffect(() => {
    const container = containerRef.current
    const listContainer = listContainerRef.current
    if (!container || !listContainer) return

    const checkMainScroll = () => {
      if (container.scrollHeight > container.clientHeight) {
        container.classList.add('scrollable')
      } else {
        container.classList.remove('scrollable')
      }
    }

    const checkListScroll = () => {
      if (listContainer.scrollHeight > listContainer.clientHeight) {
        listContainer.classList.add('scrollable')
      } else {
        listContainer.classList.remove('scrollable')
      }
    }

    // 初始检查
    checkMainScroll()
    checkListScroll()

    // 监听窗口大小变化
    window.addEventListener('resize', () => {
      checkMainScroll()
      checkListScroll()
    })

    // 监听内容变化（使用MutationObserver）
    const mainObserver = new MutationObserver(checkMainScroll)
    mainObserver.observe(container, { childList: true, subtree: true })

    const listObserver = new MutationObserver(checkListScroll)
    listObserver.observe(listContainer, { childList: true, subtree: true })

    // 主容器始终保持可滚动状态
    container.style.overflowY = 'auto'

    // 添加滚动指示器
    const addScrollIndicator = () => {
      const scrollIndicator = document.createElement('div')
      scrollIndicator.className = 'scroll-indicator'
      scrollIndicator.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background-color: var(--color-primary);
        opacity: 0.7;
        pointer-events: none;
        z-index: 1000;
        display: flex;
        justify-content: center;
        align-items: center;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        transition: opacity 0.3s ease;
      `

      // 添加箭头图标
      scrollIndicator.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>`

      document.body.appendChild(scrollIndicator)

      // 2秒后淡出
      setTimeout(() => {
        scrollIndicator.style.opacity = '0'
        setTimeout(() => {
          document.body.removeChild(scrollIndicator)
        }, 300)
      }, 2000)
    }

    // 首次加载时显示滚动指示器
    if (container.scrollHeight > container.clientHeight) {
      addScrollIndicator()
    }

    // 添加滚动事件监听器，当用户滚动时显示滚动指示器
    let scrollTimeout: NodeJS.Timeout | null = null
    const handleContainerScroll = () => {
      // 清除之前的定时器
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }

      // 如果容器可滚动，显示滚动指示器
      if (container.scrollHeight > container.clientHeight) {
        // 如果已经滚动到底部，不显示指示器
        if (container.scrollHeight - container.scrollTop - container.clientHeight > 20) {
          // 设置定时器，延迟显示滚动指示器
          scrollTimeout = setTimeout(() => {
            addScrollIndicator()
          }, 500)
        }
      }
    }

    container.addEventListener('scroll', handleContainerScroll)

    return () => {
      window.removeEventListener('resize', checkMainScroll)
      mainObserver.disconnect()
      listObserver.disconnect()
      // 移除滚动事件监听器
      container.removeEventListener('scroll', handleContainerScroll)
      // 清除定时器
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }
    }
  }, [])

  return (
    <SettingContainer theme={theme} ref={containerRef}>
      {/* 1. 将 TabsContainer 移到 SettingContainer 顶部 */}
      <TabsContainer>
        <Tabs
          defaultActiveKey="shortMemory"
          size="large"
          animated={{ inkBar: true, tabPane: true }}
          items={[
            {
              key: 'shortMemory',
              label: (
                <TabLabelContainer>
                  <TabDot color="#52c41a">●</TabDot>
                  {t('settings.memory.shortMemory') || '短期记忆'}
                </TabLabelContainer>
              ),
              children: (
                // 将原来<Tabs.TabPane>...</Tabs.TabPane>中的内容放在这里
                <TabPaneSettingGroup theme={theme}>
                  <SettingTitle>{t('settings.memory.title')}</SettingTitle>
                  <SettingHelpText>{t('settings.memory.description')}</SettingHelpText>
                  <SettingDivider />

                  <SettingTitle>{t('settings.memory.shortMemorySettings')}</SettingTitle>
                  <SettingHelpText>{t('settings.memory.shortMemoryDescription')}</SettingHelpText>
                  <SettingDivider />

                  {/* 保留原有的短期记忆设置 */}
                  <SettingRow>
                    <SettingRowTitle>{t('settings.memory.enableMemory')}</SettingRowTitle>
                    <Switch checked={isActive} onChange={handleToggleMemory} />
                  </SettingRow>
                  <SettingRow>
                    <SettingRowTitle>{t('settings.memory.enableAutoAnalyze')}</SettingRowTitle>
                    <Switch checked={autoAnalyze} onChange={handleToggleAutoAnalyze} disabled={!isActive} />
                  </SettingRow>

                  {/* 短期记忆分析模型选择 */}
                  {autoAnalyze && isActive && (
                    <SettingRow>
                      <SettingRowTitle>
                        {t('settings.memory.shortMemoryAnalyzeModel') || '短期记忆分析模型'}
                      </SettingRowTitle>
                      <Select
                        style={{ width: 250 }}
                        value={shortMemoryAnalyzeModel}
                        onChange={handleSelectShortMemoryModel}
                        placeholder={t('settings.memory.selectModel') || '选择模型'}
                        options={modelOptions.groupedOptions}
                        disabled={!isActive || !autoAnalyze} // 确保在未激活或未开启自动分析时禁用
                        optionFilterProp="label"
                        listHeight={300}
                      />
                    </SettingRow>
                  )}

                  {/* 话题选择 */}
                  {isActive && (
                    <SettingRow>
                      <SettingRowTitle>{t('settings.memory.selectTopic') || '选择话题'}</SettingRowTitle>
                      <Select
                        style={{ width: 350 }}
                        value={selectedTopicId}
                        onChange={(value) => setSelectedTopicId(value)}
                        placeholder={t('settings.memory.selectTopicPlaceholder') || '选择要分析的话题'}
                        allowClear
                        showSearch
                        filterOption={(input, option) =>
                          (option?.label as string).toLowerCase().includes(input.toLowerCase())
                        }
                        options={topics.map((topic) => ({
                          label: topic.name || `话题 ${topic.id.substring(0, 8)}`,
                          value: topic.id
                        }))}
                        popupMatchSelectWidth={false}
                      />
                    </SettingRow>
                  )}

                  {/* 手动分析按钮 */}
                  {isActive && (
                    <SettingRow>
                      <SettingRowTitle>{t('settings.memory.manualAnalyze') || '手动分析'}</SettingRowTitle>
                      <ButtonsContainer>
                        <Button
                          onClick={() => handleManualAnalyze(true)}
                          disabled={!shortMemoryAnalyzeModel || isAnalyzing || !isActive}
                          icon={<SearchOutlined />}>
                          {t('settings.memory.analyzeNow') || '立即分析'}
                        </Button>
                        {isAnalyzing && (
                          <Button onClick={handleResetAnalyzingState} type="default" danger>
                            {t('settings.memory.resetAnalyzingState') || '重置分析状态'}
                          </Button>
                        )}
                      </ButtonsContainer>
                    </SettingRow>
                  )}

                  <SettingDivider />

                  {/* 短期记忆去重与合并面板 */}
                  <MemoryDeduplicationPanel
                    title={t('settings.memory.shortMemoryDeduplication.title') || '短期记忆去重与合并'}
                    description={
                      t('settings.memory.shortMemoryDeduplication.description') ||
                      '分析短期记忆中的相似记忆，提供智能合并建议。'
                    }
                    translationPrefix="settings.memory.shortMemoryDeduplication"
                    isShortMemory={true}
                    // disabled={!isActive} // 移除此属性
                  />

                  <SettingDivider />

                  {/* 短记忆管理器 */}
                  <CollapsibleShortMemoryManager /* disabled={!isActive} // 移除此属性 */ />
                </TabPaneSettingGroup>
              )
            },
            {
              key: 'priorityManagement',
              label: (
                <TabLabelContainer>
                  <TabDot color="#722ed1">●</TabDot>
                  {t('settings.memory.priorityManagement.title') || '智能优先级管理'}
                </TabLabelContainer>
              ),
              children: (
                <TabPaneSettingGroup theme={theme}>
                  <PriorityManagementSettings />
                </TabPaneSettingGroup>
              )
            },
            {
              key: 'longMemory',
              label: (
                <TabLabelContainer>
                  <TabDot color="#1890ff">●</TabDot>
                  {t('settings.memory.longMemory') || '长期记忆'}
                </TabLabelContainer>
              ),
              children: (
                // 将原来<Tabs.TabPane>...</Tabs.TabPane>中的内容放在这里
                <TabPaneSettingGroup theme={theme}>
                  <SettingTitle>{t('settings.memory.title')}</SettingTitle>
                  <SettingHelpText>{t('settings.memory.description')}</SettingHelpText>
                  <SettingDivider />

                  <SettingTitle>{t('settings.memory.longMemorySettings')}</SettingTitle>
                  <SettingHelpText>{t('settings.memory.longMemoryDescription')}</SettingHelpText>
                  <SettingDivider />

                  {/* 保留原有的长期记忆设置 */}
                  <SettingRow>
                    <SettingRowTitle>{t('settings.memory.enableMemory')}</SettingRowTitle>
                    <Switch checked={isActive} onChange={handleToggleMemory} />
                  </SettingRow>
                  <SettingRow>
                    <SettingRowTitle>{t('settings.memory.enableAutoAnalyze')}</SettingRowTitle>
                    <Switch checked={autoAnalyze} onChange={handleToggleAutoAnalyze} disabled={!isActive} />
                  </SettingRow>

                  {/* 长期记忆分析模型选择 */}
                  {autoAnalyze && isActive && (
                    <SettingRow>
                      <SettingRowTitle>{t('settings.memory.analyzeModel') || '长期记忆分析模型'}</SettingRowTitle>
                      <Select
                        style={{ width: 250 }}
                        value={analyzeModel}
                        onChange={handleSelectModel}
                        placeholder={t('settings.memory.selectModel') || '选择模型'}
                        options={modelOptions.groupedOptions}
                        disabled={!isActive || !autoAnalyze}
                        optionFilterProp="label"
                        listHeight={300}
                      />
                    </SettingRow>
                  )}

                  {/* 话题选择 */}
                  {isActive && (
                    <SettingRow>
                      <SettingRowTitle>{t('settings.memory.selectTopic') || '选择话题'}</SettingRowTitle>
                      <Select
                        style={{ width: 350 }}
                        value={selectedTopicId}
                        onChange={(value) => setSelectedTopicId(value)}
                        placeholder={t('settings.memory.selectTopicPlaceholder') || '选择要分析的话题'}
                        allowClear
                        showSearch
                        filterOption={(input, option) =>
                          (option?.label as string).toLowerCase().includes(input.toLowerCase())
                        }
                        options={topics.map((topic) => ({
                          label: topic.name || `话题 ${topic.id.substring(0, 8)}`,
                          value: topic.id
                        }))}
                        popupMatchSelectWidth={false}
                      />
                    </SettingRow>
                  )}

                  {/* 手动分析按钮 */}
                  {isActive && (
                    <SettingRow>
                      <SettingRowTitle>{t('settings.memory.manualAnalyze') || '手动分析'}</SettingRowTitle>
                      <ButtonsContainer>
                        <Button
                          onClick={() => handleManualAnalyze(false)}
                          disabled={!analyzeModel || isAnalyzing || !isActive}
                          icon={<SearchOutlined />}>
                          {t('settings.memory.analyzeNow') || '立即分析'}
                        </Button>
                        {isAnalyzing && (
                          <Button onClick={handleResetAnalyzingState} type="default" danger>
                            {t('settings.memory.resetAnalyzingState') || '重置分析状态'}
                          </Button>
                        )}
                      </ButtonsContainer>
                    </SettingRow>
                  )}

                  <SettingDivider />

                  {/* 记忆列表管理器 */}
                  <MemoryListManager
                    onSelectList={() => {
                      // 当选择了一个记忆列表时，重置分类筛选器
                      setCategoryFilter(null)
                    }}
                    // disabled={!isActive} // 移除此属性
                  />

                  <SettingDivider />

                  {/* 长期记忆去重与合并面板 */}
                  <MemoryDeduplicationPanel
                    // title/description/prefix 由组件内部处理默认值
                    isShortMemory={false} // 明确指定为长期记忆
                    // disabled={!isActive} // 移除此属性
                  />

                  <SettingDivider />

                  {/* 记忆列表标题和操作按钮 */}
                  <MemoryListHeader>
                    <SettingTitle>{t('settings.memory.memoriesList')}</SettingTitle>
                    <ButtonGroup>
                      <StyledRadioGroup
                        value={viewMode}
                        onChange={(e) => setViewMode(e.target.value)}
                        buttonStyle="solid"
                        disabled={!isActive}>
                        <Radio.Button value="list">
                          <UnorderedListOutlined /> {t('settings.memory.listView')}
                        </Radio.Button>
                        <Radio.Button value="mindmap">
                          <AppstoreOutlined /> {t('settings.memory.mindmapView')}
                        </Radio.Button>
                      </StyledRadioGroup>
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => setIsAddModalVisible(true)}
                        disabled={!isActive}>
                        {t('settings.memory.addMemory')}
                      </Button>
                      <Button
                        danger
                        onClick={() => setIsClearModalVisible(true)}
                        disabled={!isActive || memories.length === 0}>
                        {t('settings.memory.clearAll')}
                      </Button>
                    </ButtonGroup>
                  </MemoryListHeader>

                  {/* 分类筛选器 */}
                  {memories.length > 0 && isActive && (
                    <CategoryFilterContainer>
                      <span>{t('settings.memory.filterByCategory') || '按分类筛选：'}</span>
                      <div>
                        <TagWithCursor
                          color={categoryFilter === null ? 'blue' : undefined}
                          onClick={() => setCategoryFilter(null)}>
                          {t('settings.memory.allCategories') || '全部'}
                        </TagWithCursor>
                        {Array.from(new Set(memories.filter((m) => m.category).map((m) => m.category))).map(
                          (category) => (
                            <TagWithCursor
                              key={category}
                              color={categoryFilter === category ? 'blue' : undefined}
                              onClick={() => setCategoryFilter(category || null)}>
                              {category || t('settings.memory.uncategorized') || '未分类'}
                            </TagWithCursor>
                          )
                        )}
                      </div>
                    </CategoryFilterContainer>
                  )}

                  {/* 记忆列表 */}
                  <MemoryListContainer ref={listContainerRef}>
                    {viewMode === 'list' ? (
                      memories.length > 0 && isActive ? (
                        <List
                          itemLayout="horizontal"
                          style={{ minHeight: '350px' }}
                          dataSource={memories
                            .filter((memory) => (currentListId ? memory.listId === currentListId : true))
                            .filter((memory) => categoryFilter === null || memory.category === categoryFilter)}
                          renderItem={(memory) => (
                            <List.Item
                              actions={[
                                <Tooltip key="edit" title={t('common.edit')}>
                                  <Button
                                    icon={<EditOutlined />}
                                    type="text"
                                    onClick={() => {
                                      setEditingMemory({ id: memory.id, content: memory.content })
                                      setIsEditModalVisible(true)
                                    }}
                                    disabled={!isActive}
                                  />
                                </Tooltip>,
                                <Tooltip key="delete" title={t('common.delete')}>
                                  <Button
                                    icon={<DeleteOutlined />}
                                    type="text"
                                    danger
                                    onClick={() => handleDeleteMemory(memory.id)}
                                    disabled={!isActive}
                                  />
                                </Tooltip>
                              ]}>
                              <List.Item.Meta
                                title={
                                  <div>
                                    {memory.category && <TagWithCursor color="blue">{memory.category}</TagWithCursor>}
                                    {memory.content}
                                  </div>
                                }
                                description={
                                  <MemoryItemMeta>
                                    <span>{new Date(memory.createdAt).toLocaleString()}</span>
                                    {memory.source && <span>{memory.source}</span>}
                                  </MemoryItemMeta>
                                }
                              />
                            </List.Item>
                          )}
                        />
                      ) : (
                        <Empty description={t('settings.memory.noMemories')} />
                      )
                    ) : isActive ? (
                      <MemoryMindMapContainer>
                        <MemoryMindMap
                          memories={memories.filter((memory) =>
                            currentListId ? memory.listId === currentListId : true
                          )}
                          onEditMemory={(id) => {
                            const memory = memories.find((m) => m.id === id)
                            if (memory) {
                              setEditingMemory({ id: memory.id, content: memory.content })
                              setIsEditModalVisible(true)
                            }
                          }}
                          onDeleteMemory={handleDeleteMemory}
                        />
                      </MemoryMindMapContainer>
                    ) : (
                      <Empty description={t('settings.memory.enableMemoryFirst') || '请先启用记忆功能'} />
                    )}
                  </MemoryListContainer>
                </TabPaneSettingGroup>
              )
            }
          ]}
        />
      </TabsContainer>
      {/* 8. 移除外部的 SettingGroup 包裹，Modal 等保持在 SettingContainer 内 */}
      {/* 添加记忆对话框 (保持不变) */}
      <Modal
        title={t('settings.memory.addMemory')}
        open={isAddModalVisible}
        onOk={handleAddMemory}
        onCancel={() => setIsAddModalVisible(false)}
        okButtonProps={{ disabled: !newMemory.trim() }}>
        <Input.TextArea
          rows={4}
          value={newMemory}
          onChange={(e) => setNewMemory(e.target.value)}
          placeholder={t('settings.memory.memoryPlaceholder')}
        />
      </Modal>

      {/* 编辑记忆对话框 */}
      <Modal
        title={t('settings.memory.editMemory')}
        open={isEditModalVisible}
        onOk={handleEditMemory}
        onCancel={() => setIsEditModalVisible(false)}
        okButtonProps={{ disabled: !editingMemory?.content.trim() }}>
        <Input.TextArea
          rows={4}
          value={editingMemory?.content || ''}
          onChange={(e) => setEditingMemory((prev) => (prev ? { ...prev, content: e.target.value } : null))}
          placeholder={t('settings.memory.memoryPlaceholder')}
        />
      </Modal>

      {/* 清空记忆确认对话框 */}
      <Modal
        title={t('settings.memory.clearConfirmTitle')}
        open={isClearModalVisible}
        onOk={handleClearMemories}
        onCancel={() => setIsClearModalVisible(false)}
        okButtonProps={{ danger: true }}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}>
        <p>
          {currentListId
            ? t('settings.memory.clearConfirmContentList', {
                name: memoryLists.find((list) => list.id === currentListId)?.name || ''
              })
            : t('settings.memory.clearConfirmContent')}
        </p>
      </Modal>
    </SettingContainer>
  )
}

const MemoryListHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`

const ButtonGroup = styled.div`
  display: flex;
  gap: 8px;
`

const MemoryListContainer = styled.div`
  max-height: calc(60vh - 100px);
  min-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 8px;
  position: relative; /* 为滚动指示器添加定位上下文 */

  /* 确保容器高度可以自适应 */
  &:has(.ant-list) {
    height: auto;
  }

  /* 添加媒体查询以适应不同屏幕尺寸 */
  @media (min-height: 900px) {
    max-height: calc(70vh - 100px);
  }

  @media (max-height: 700px) {
    max-height: calc(50vh - 80px);
  }

  /* 自定义滚动条样式 */
  &::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--color-primary);
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  /* 滚动指示器 */
  &::after {
    content: '';
    position: absolute;
    bottom: 10px;
    right: 10px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background-color: var(--color-primary);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
    background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>');
    background-repeat: no-repeat;
    background-position: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transform: rotate(180deg);
  }

  &.scrollable::after {
    opacity: 0.7;
  }
`

const MemoryItemMeta = styled.div`
  display: flex;
  justify-content: space-between;
  color: var(--color-text-3);
  font-size: 12px;
`

const TabLabelContainer = styled.span`
  display: flex;
  align-items: center;
  gap: 8px;
`

const TabDot = styled.span<{ color: string }>`
  font-size: 18px;
  color: ${(props) => props.color};
`

const ButtonsContainer = styled.div`
  display: flex;
  gap: 8px;
`

const TagWithCursor = styled(Tag)`
  cursor: pointer;
  margin-right: 8px;
`

const StyledRadioGroup = styled(Radio.Group)`
  margin-right: 16px;
`

const TabPaneSettingGroup = styled(SettingGroup)`
  border-top-left-radius: 0;
  border-top-right-radius: 0;
  margin-top: 0;
`

const MemoryMindMapContainer = styled.div`
  width: 100%;
  height: calc(60vh - 100px);
  min-height: 400px;
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;

  /* 添加媒体查询以适应不同屏幕尺寸 */
  @media (min-height: 900px) {
    height: calc(70vh - 100px);
  }

  @media (max-height: 700px) {
    height: calc(50vh - 80px);
  }
`

const CategoryFilterContainer = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 8px;

  > span {
    margin-right: 8px;
    font-weight: 500;
  }

  > div {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
`

const TabsContainer = styled.div`
  margin: -20px -20px 0 -20px; /* 负边距使选项卡扩展到容器边缘 */

  .ant-tabs {
    width: 100%;
  }

  .ant-tabs-nav {
    margin-bottom: 0;
    background: var(--color-background-soft);
    padding: 0;
    border-radius: 0;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    position: relative;
    overflow: hidden;
    border-bottom: 1px solid var(--color-border);
  }

  .ant-tabs-nav::before {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background-color: var(--color-border);
    opacity: 0.5;
  }

  .ant-tabs-nav-wrap {
    padding: 0 8px;
  }

  .ant-tabs-tab {
    font-weight: 500;
    padding: 14px 24px;
    margin: 0 4px;
    transition: all 0.3s;
    border-radius: 8px 8px 0 0;
    position: relative;
    top: 1px;
  }

  .ant-tabs-tab:first-child {
    margin-left: 8px;
  }

  .ant-tabs-tab:hover {
    color: var(--color-primary);
    background-color: rgba(0, 0, 0, 0.02);
  }

  .ant-tabs-tab-active {
    background-color: var(--color-background-soft);
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
  }

  .ant-tabs-tab-active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background-color: var(--color-primary);
    border-radius: 3px 3px 0 0;
  }

  .ant-tabs-tab-active .ant-tabs-tab-btn {
    color: var(--color-primary) !important;
    font-weight: 600;
  }

  .ant-tabs-ink-bar {
    display: none;
  }

  .ant-tabs-content-holder {
    padding: 0;
  }

  .ant-tabs-nav-operations {
    display: none !important;
  }
`

export default MemorySettings
