import { SearchOutlined } from '@ant-design/icons'
import { HStack, VStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import { TopView } from '@renderer/components/TopView'
import predefinedVariables, { VariableDefinition } from '@renderer/services/PredefinedVariables'
import { Variable } from '@renderer/types'
import { Divider, Empty, Input, InputRef, Modal, Typography } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  onSelect?: (variableName: string) => void
  customVariables?: Variable[]
}

interface PopupContainerProps extends Props {
  resolve: (value: string | undefined) => void
}

// 最大缓存时间 - 15秒，避免搜索状态持久化太久
const SEARCH_CACHE_TIMEOUT = 15 * 1000
let lastSearchText = ''
let lastSearchTime = 0

const PopupContainer: React.FC<PopupContainerProps> = ({ resolve, customVariables }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  // 尝试恢复最近的搜索，但仅限于短时间内
  const initialSearchText = Date.now() - lastSearchTime < SEARCH_CACHE_TIMEOUT ? lastSearchText : ''
  const [searchText, setSearchText] = useState(initialSearchText)
  const inputRef = useRef<InputRef>(null)
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // 更新搜索缓存
  useEffect(() => {
    lastSearchText = searchText
    lastSearchTime = Date.now()
  }, [searchText])

  const groups = useMemo(() => {
    // 获取预定义变量组
    const predefinedGroups = predefinedVariables.getAllGroups()

    // 如果有自定义变量，创建自定义变量组
    if (!customVariables?.length) {
      return predefinedGroups
    }

    // 创建自定义组
    const customGroup = {
      id: 'custom',
      name: t('variable.custom_variables'),
      variables: customVariables.map((v) => ({
        id: v.id,
        name: `custom.${v.name}`,
        description: v.value,
        getValue: () => v.value
      }))
    }

    // 将自定义组放在最前面
    return [customGroup, ...predefinedGroups]
  }, [customVariables, t])

  // 根据搜索和分组筛选变量
  const filteredGroups = useMemo(() => {
    if (!searchText.trim() && !selectedGroup) {
      return groups
    }

    // 应用筛选
    return (
      groups
        .map((group) => {
          // 如果选择了特定组且不是当前组，并且没有搜索词，则清空该组变量
          if (selectedGroup && group.id !== selectedGroup && !searchText) {
            return { ...group, variables: [] }
          }

          // 如果有搜索词，按关键词过滤
          if (searchText.trim()) {
            // 分词搜索，支持多个空格分隔的关键词
            const keywords = searchText.toLowerCase().split(/\s+/).filter(Boolean) // 移除空字符串

            // 过滤符合搜索条件的变量
            const filteredVars = group.variables.filter((variable) => {
              const fullText = `${variable.name} ${variable.description}`
              const lowerFullText = fullText.toLowerCase()
              // 每个关键词都必须匹配
              return keywords.every((keyword) => lowerFullText.includes(keyword))
            })

            return { ...group, variables: filteredVars }
          }

          // 不改变原组
          return group
        })
        // 只保留有变量的组
        .filter((group) => group.variables.length > 0)
    )
  }, [groups, searchText, selectedGroup])

  // 变量选择处理
  const handleVariableSelect = (variable: VariableDefinition) => {
    resolve(variable.name)
    setOpen(false)
  }

  // 弹窗关闭处理
  const handleCancel = () => {
    setOpen(false)
  }

  // 最终关闭处理
  const handleClose = () => {
    resolve(undefined)
    SelectVariablePopup.hide()
  }

  // 自动聚焦搜索框
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // 渲染变量组列表
  const renderGroups = () => {
    // 没有匹配结果时显示空状态
    if (filteredGroups.length === 0) {
      return (
        <EmptyState>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('variable.no_results')} />
        </EmptyState>
      )
    }

    // 渲染过滤后的变量组
    return (
      <VStack gap={16} style={{ padding: '0 8px' }}>
        {filteredGroups.map((group) => {
          // 跳过没有变量的组
          if (!group.variables.length) return null

          return (
            <VStack key={group.id} gap={4} width="100%">
              <Typography.Title level={5} style={{ margin: '0' }}>
                {group.name}
              </Typography.Title>
              <Divider style={{ margin: '4px 0' }} />

              {/* 变量列表 */}
              {group.variables.map((variable) => (
                <VariableItem key={variable.id} onClick={() => handleVariableSelect(variable)}>
                  <Typography.Text strong style={{ fontSize: '14px' }}>
                    {`{{${variable.name}}}`}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ marginLeft: '8px', fontSize: '12px' }}>
                    {variable.description}
                  </Typography.Text>
                </VariableItem>
              ))}
            </VStack>
          )
        })}
      </VStack>
    )
  }

  const modalWidth = 600
  const searchBarTopMargin = 5
  const scrollHeight = '40vh'

  return (
    <Modal
      centered
      open={open}
      onCancel={handleCancel}
      afterClose={handleClose}
      transitionName="ant-move-down"
      styles={{
        content: {
          borderRadius: 20,
          padding: 0,
          overflow: 'hidden',
          paddingBottom: 20,
          border: '1px solid var(--color-border)'
        },
        header: {
          paddingBottom: 10
        }
      }}
      closeIcon
      footer={null}
      width={modalWidth}>
      <HStack style={{ padding: '0 12px', marginTop: searchBarTopMargin }}>
        <Input
          prefix={
            <SearchIcon>
              <SearchOutlined />
            </SearchIcon>
          }
          ref={inputRef}
          placeholder={t('common.search')}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          autoFocus
          style={{ paddingLeft: 0 }}
          variant="borderless"
          size="middle"
        />
      </HStack>

      <Divider style={{ margin: 0, marginTop: 5, borderBlockStartWidth: 0.5 }} />

      <Container>
        <HStack alignItems="flex-start" gap={0}>
          {!searchText && (
            <>
              <GroupList>
                <GroupItem onClick={() => setSelectedGroup(null)} $isActive={selectedGroup === null}>
                  {t('common.all')}
                </GroupItem>

                {groups.map((group) => (
                  <GroupItem
                    key={group.id}
                    onClick={() => setSelectedGroup(group.id)}
                    $isActive={selectedGroup === group.id}>
                    {group.name}
                  </GroupItem>
                ))}
              </GroupList>

              <Divider type="vertical" style={{ height: scrollHeight, margin: '0 10px' }} />
            </>
          )}

          <Scrollbar style={{ height: scrollHeight, flex: 1 }} ref={scrollContainerRef}>
            {renderGroups()}
          </Scrollbar>
        </HStack>
      </Container>
    </Modal>
  )
}

// 布局组件
const Container = styled.div`
  margin: 16px 8px 0;
`

const GroupList = styled.div`
  width: 150px;
  padding: 5px;
`

const GroupItem = styled.div<{ $isActive: boolean }>`
  padding: 8px 12px;
  margin-bottom: 4px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: ${(props) => (props.$isActive ? '600' : 'normal')};
  background-color: ${(props) => (props.$isActive ? 'var(--color-background-mute)' : 'transparent')};

  &:hover {
    background-color: ${(props) => !props.$isActive && 'var(--color-background-soft)'};
  }
`

const VariableItem = styled.div`
  cursor: pointer;
  padding: 8px 12px;
  border-radius: 6px;

  &:hover {
    background-color: var(--color-background-soft);
  }
`

const EmptyState = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
`

const SearchIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: var(--color-background-soft);
  margin-right: 2px;
`

// 静态类接口
export default class SelectVariablePopup {
  static hide() {
    TopView.hide('SelectVariablePopup')
  }

  static show(params: Props = {}) {
    return new Promise<string | undefined>((resolve) => {
      TopView.show(<PopupContainer {...params} resolve={resolve} />, 'SelectVariablePopup')
    })
  }
}
