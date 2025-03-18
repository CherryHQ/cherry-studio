import { CloseCircleOutlined, CloseOutlined, PushpinOutlined } from '@ant-design/icons'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { getTopicById } from '@renderer/hooks/useTopic'
import { EventEmitter } from '@renderer/services/EventService'
import { EVENT_NAMES } from '@renderer/services/EventService'
import store, { RootState } from '@renderer/store'
import { removeTopicInfo, updateTopicInfo } from '@renderer/store/topicInfo'
import { Assistant, Topic } from '@renderer/types'
import { Dropdown, MenuProps, Tabs as TabsAntd, Tooltip } from 'antd'
import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import BreadcrumbNavigator from './Breadcrumb'

interface Props {
  activeTopicId: string
  activeAssistantId: string
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant?: (assistant: Assistant) => void
}

const Tabs = styled(TabsAntd)`
  .ant-tabs-nav {
    margin-bottom: 0;
  }
  .ant-tabs-tab {
    transition: all 0.3s cubic-bezier(0.645, 0.045, 0.355, 1);
    color: var(--color-text) !important;
    background: var(--color-background-soft) !important;
    border: none !important;
  }
  .ant-tabs-tab:hover {
    color: var(--color-text) !important;
    background-color: var(--color-background-mute) !important;
  }
  .ant-tabs-tab-active {
    background: var(--color-background-mute) !important;
    color: var(--color-text) !important;
    transform: scale(1.02);
  }
  .ant-tabs-tab-btn:active {
    color: var(--color-text) !important;
  }
  .ant-tabs-tab-active {
    .ant-tabs-tab-btn {
      color: var(--color-text) !important;
    }
  }
  .ant-tabs-content {
    transition: all 0.3s cubic-bezier(0.645, 0.045, 0.355, 1);
  }
  .ant-tabs-ink-bar {
    display: none !important;
  }
  .ant-tabs-tabpane {
    transition: none !important;
  }
`

const TabLabel = styled.div<{ width?: number }>`
  width: ${(props) => (props.width ? `${props.width}px` : '120px')};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  font-family: Ubuntu;
  font-size: 13px;
`

const PinIcon = styled(PushpinOutlined)`
  font-size: 12px;
  margin-right: 6px;
  color: var(--color-text-3);
`

const ContentTab: React.FC<Props> = ({ activeTopicId, activeAssistantId, setActiveTopic, setActiveAssistant }) => {
  const topicInfos = useSelector((state: RootState) => state.topicInfos.topicInfos)
  const { findAssistantByTopicId } = useAssistants()
  const { topicPosition } = useSettings()
  const { t } = useTranslation()

  // 用于控制右键菜单的状态
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    topicId: string
  }>({
    visible: false,
    x: 0,
    y: 0,
    topicId: ''
  })

  // 处理标签切换
  const handleChange = useCallback(
    async (activeTopicId: string) => {
      const topic = await getTopicById(activeTopicId)
      if (topic) {
        const topicInfo = topicInfos.find((t) => t.id === activeTopicId)
        if (topicInfo && setActiveAssistant) {
          const currentAssitant = findAssistantByTopicId(topicInfo.id)
          if (currentAssitant && currentAssitant.id !== activeAssistantId) {
            setActiveAssistant(currentAssitant)
          }
        }
        // 确保侧边栏切换到话题标签页
        if (topicPosition === 'left') {
          EventEmitter.emit(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR)
        }
        setActiveTopic(topic)
      }
    },
    [topicInfos, findAssistantByTopicId, activeAssistantId, setActiveAssistant, topicPosition, setActiveTopic]
  )

  // 处理标签关闭
  const handleEdit = useCallback(
    async (targetKey, action) => {
      if (action === 'remove') {
        const currentIndex = topicInfos.findIndex((t) => t.id === targetKey)
        const currentTopic = topicInfos[currentIndex]
        if (currentTopic.pinned) {
          store.dispatch(
            updateTopicInfo({
              ...currentTopic,
              pinned: false
            })
          )
          return
        }
        if (currentIndex >= 0) {
          const nextIndex = currentIndex + 1 < topicInfos.length ? currentIndex + 1 : currentIndex - 1

          if (nextIndex >= 0) {
            await handleChange(topicInfos[nextIndex].id)
            store.dispatch(removeTopicInfo(targetKey as string))
          }
        }
      }
    },
    [topicInfos, handleChange]
  )

  // 处理右键菜单打开
  const handleContextMenu = useCallback((event: React.MouseEvent, topicId: string) => {
    // 阻止默认的上下文菜单
    event.preventDefault()

    // 更新上下文菜单状态
    setContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      topicId
    })
  }, [])

  // 处理右键菜单关闭
  const handleMenuClose = useCallback(() => {
    setContextMenu((prev) => ({
      ...prev,
      visible: false
    }))
  }, [])

  // 获取右键菜单项
  const getMenuItems = useCallback((): MenuProps['items'] => {
    const { topicId } = contextMenu
    if (!topicId) return []

    const currentTopic = topicInfos.find((t) => t.id === topicId)
    if (!currentTopic) return []

    return [
      {
        key: 'pin',
        label: currentTopic.pinned ? t('tabs.unpin_tab') : t('tabs.pin_tab'),
        icon: <PushpinOutlined />,
        onClick: () => {
          store.dispatch(
            updateTopicInfo({
              ...currentTopic,
              pinned: !currentTopic.pinned
            })
          )
          handleMenuClose()
        }
      },
      {
        key: 'close_right',
        label: t('tabs.close_right'),
        icon: <CloseOutlined />,
        onClick: () => {
          const currentIndex = topicInfos.findIndex((t) => t.id === topicId)
          if (currentIndex >= 0) {
            const tabsToRight = topicInfos.slice(currentIndex + 1)
            tabsToRight
              .filter((tab) => !tab.pinned)
              .forEach((tab) => {
                store.dispatch(removeTopicInfo(tab.id))
              })
          }
          handleMenuClose()
        }
      },
      {
        key: 'close_others',
        label: t('tabs.close_others'),
        icon: <CloseCircleOutlined />,
        onClick: () => {
          topicInfos
            .filter((tab) => tab.id !== topicId && !tab.pinned)
            .forEach((tab) => {
              store.dispatch(removeTopicInfo(tab.id))
            })
          handleMenuClose()
        }
      }
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu.topicId, topicInfos, handleMenuClose])

  // 生成标签项
  const items = useMemo(
    () =>
      topicInfos.map((topic) => ({
        key: topic.id,
        label: (
          <Tooltip title={topic.name} placement="bottom">
            <TabLabel width={100} onContextMenu={(e) => handleContextMenu(e, topic.id)}>
              {`${topic.assistantEmoji} ${topic.name}`}
            </TabLabel>
          </Tooltip>
        ),
        closeIcon: topic.pinned ? <PinIcon /> : <CloseOutlined />
      })),
    [topicInfos, handleContextMenu]
  )

  return (
    <div>
      <Tabs
        type="editable-card"
        animated={false}
        hideAdd
        tabPosition="top"
        onChange={handleChange}
        activeKey={activeTopicId}
        onEdit={handleEdit}
        items={items}
      />
      <BreadcrumbNavigator
        activeAssistantId={activeAssistantId}
        activeTopicId={activeTopicId}
        setActiveTopic={setActiveTopic}
        setActiveAssistant={setActiveAssistant}
      />

      {/* 独立的右键菜单 */}
      {contextMenu.visible && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 1000
          }}
          onClick={handleMenuClose}>
          <div
            style={{
              position: 'absolute',
              top: contextMenu.y,
              left: contextMenu.x
            }}>
            <Dropdown menu={{ items: getMenuItems() }} open={true} trigger={[]}>
              <div style={{ width: 1, height: 1 }} />
            </Dropdown>
          </div>
        </div>
      )}
    </div>
  )
}

export default ContentTab
