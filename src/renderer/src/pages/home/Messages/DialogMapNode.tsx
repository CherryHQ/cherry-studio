import {
  ArrowRightOutlined,
  DeleteOutlined,
  MinusOutlined,
  PlusOutlined,
  RobotOutlined,
  UserOutlined
} from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { getModelLogo } from '@renderer/config/models'
import { Model } from '@renderer/types'
import { Handle, Position } from '@xyflow/react'
import { Avatar, Dropdown, Modal, Tooltip } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

// 组件数据接口定义
interface DialogMapNodeData {
  nodeId: string
  type: 'user' | 'assistant'
  content: string
  userContent?: string
  messageId?: string
  model?: string
  modelId?: string
  modelInfo?: Model | null
  isSelected: boolean
  isCollapsed: boolean
  childrenCount: number
  onNodeClick?: (nodeId: string) => void
  onAddBranch?: (nodeId: string) => void
  onDeleteNode?: (nodeId: string) => void
  onNavigateToNode?: (nodeId: string) => void
  onToggleCollapse?: (nodeId: string, isCollapsed: boolean) => void
}

// 组件接口定义
interface DialogMapNodeProps {
  data: DialogMapNodeData
}

// 自定义节点组件
const DialogMapNode: FC<DialogMapNodeProps> = ({ data }) => {
  const { t } = useTranslation()
  const nodeType = data.type
  let borderColor = '#d9d9d9' // 默认边框颜色
  let title = ''
  let backgroundColor = '#ffffff' // 默认背景色
  let gradientColor = 'rgba(0, 0, 0, 0.03)' // 默认渐变色
  const isSelected = data.isSelected
  const [showAddBranchArrow, setShowAddBranchArrow] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(data.isCollapsed)

  // 当外部折叠状态变化时更新内部状态
  useEffect(() => {
    setIsCollapsed(data.isCollapsed)
  }, [data.isCollapsed])

  // 判断是否为合并的用户-模型对卡片
  const isCombined = !!data.userContent
  const userContent = data.userContent
  const hasChildren = data.childrenCount > 0

  // 根据节点类型和合并状态设置样式
  if (isCombined) {
    // 合并模式 - 用户和助手在同一个卡片
    borderColor = isSelected ? 'var(--color-primary)' : 'var(--color-black-mute)'
    backgroundColor = isSelected ? 'var(--color-primary-mute)' : 'var(--color-black-soft)'
    gradientColor = isSelected ? 'var(--color-primary-soft)' : 'var(--color-black-mute-soft)'
    title = `${data.model || t('dialogMap.unknown_model')}`
  } else if (nodeType === 'user') {
    // 单独的用户节点
    borderColor = isSelected ? 'var(--color-primary)' : 'var(--color-link)' // 用户节点颜色
    backgroundColor = isSelected ? 'var(--color-primary-mute)' : 'var(--color-link-soft)'
    gradientColor = isSelected ? 'var(--color-primary-soft)' : 'var(--color-link-mute)'
    title = t('chat.history.user_node')
  } else if (nodeType === 'assistant') {
    // 单独的助手节点
    borderColor = isSelected ? 'var(--color-primary)' : 'var(--color-black-mute)' // 助手节点颜色
    backgroundColor = isSelected ? 'var(--color-primary-mute)' : 'var(--color-black-soft)'
    gradientColor = isSelected ? 'var(--color-primary-soft)' : 'var(--color-black-mute-soft)'
    title = `${data.model || t('dialogMap.unknown_model')}`
  }

  // 处理节点点击事件，选择节点路径
  const handleNodeClick = () => {
    if (data.onNodeClick && data.nodeId) {
      data.onNodeClick(data.nodeId)
    }
  }

  // 处理添加分支按钮点击
  const handleAddBranch = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (data.onAddBranch && data.nodeId) {
      data.onAddBranch(data.nodeId)
    }
  }

  // 处理鼠标悬停在加号按钮上
  const handleAddBranchHover = (isHovering: boolean) => {
    setShowAddBranchArrow(isHovering)
  }

  // 处理折叠/展开点击
  const handleCollapseClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const newIsCollapsed = !isCollapsed
    setIsCollapsed(newIsCollapsed)
    if (data.onToggleCollapse) {
      data.onToggleCollapse(data.nodeId, newIsCollapsed)
    }
  }

  // 安全执行删除操作
  const handleSafeDelete = () => {
    if (data.onDeleteNode && data.nodeId) {
      data.onDeleteNode(data.nodeId)
    }
  }

  // 右键菜单项
  const contextMenuItems = [
    {
      key: 'navigate',
      label: t('dialogMap.navigate_to_node'),
      icon: <ArrowRightOutlined />,
      onClick: () => {
        if (data.onNavigateToNode && data.nodeId) {
          data.onNavigateToNode(data.nodeId)
        }
      }
    },
    {
      key: 'delete',
      label: t('dialogMap.delete_node'),
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => {
        if (data.onDeleteNode && data.nodeId) {
          Modal.confirm({
            title: t('dialogMap.delete_node_confirm_title'),
            content: t('dialogMap.delete_node_confirm_content'),
            okText: t('common.delete'),
            cancelText: t('common.cancel'),
            okButtonProps: { danger: true },
            onOk: handleSafeDelete
          })
        }
      }
    }
  ]

  // 隐藏连接点的通用样式
  const handleStyle = {
    opacity: 0,
    width: '12px',
    height: '12px',
    background: 'transparent',
    border: 'none'
  }

  // 获取模型头像图标
  const getModelAvatar = () => {
    // 如果有完整的modelInfo对象，优先使用ModelAvatar组件
    if (data.modelInfo) {
      try {
        return <ModelAvatar model={data.modelInfo as any} size={22} />
      } catch (error) {
        console.error('Error rendering ModelAvatar:', error)
      }
    }
    // 如果只有modelId，使用普通Avatar组件
    if (data.modelId) {
      const logoSrc = getModelLogo(data.modelId)
      return (
        <Avatar
          src={logoSrc}
          icon={!logoSrc ? <RobotOutlined /> : undefined}
          style={{ backgroundColor: 'var(--color-black-mute)' }}
          size={22}
        />
      )
    }
    // 默认fallback
    return <Avatar icon={<RobotOutlined />} style={{ backgroundColor: 'var(--color-black-mute)' }} size={22} />
  }

  const tooltipTitle = (
    <TooltipContent>
      <TooltipTitle>{title}</TooltipTitle>
      {isCombined ? (
        <>
          <TooltipBody>
            <strong>{t('chat.history.user_node')}:</strong> {userContent}
            <hr style={{ margin: '8px 0', borderColor: 'rgba(255, 255, 255, 0.1)' }} />
            <strong>{title}:</strong> {data.content}
          </TooltipBody>
        </>
      ) : (
        <TooltipBody>{data.content}</TooltipBody>
      )}
      <TooltipFooter>{t('dialogMap.click_to_select')}</TooltipFooter>
    </TooltipContent>
  )

  // 使用一个包装的Dropdown来处理右键菜单
  return (
    <Dropdown menu={{ items: contextMenuItems }} trigger={['contextMenu']}>
      <NodeWrapper>
        {/* 将操作按钮放在主要Tooltip之外，避免干扰 */}
        {/* 只在助手/组合节点显示添加分支按钮 */}
        {(nodeType === 'assistant' || isCombined) && (
          <AddBranchButtonContainer
            onMouseEnter={() => handleAddBranchHover(true)}
            onMouseLeave={() => handleAddBranchHover(false)}>
            <Tooltip title={t('dialogMap.create_branch')} placement="top">
              <AddBranchButtonOutside onClick={handleAddBranch}>
                <PlusOutlined />
              </AddBranchButtonOutside>
            </Tooltip>
            {showAddBranchArrow && <BranchArrow />}
          </AddBranchButtonContainer>
        )}

        {/* 添加折叠按钮 */}
        {hasChildren && (
          <Tooltip title={isCollapsed ? t('dialogMap.expand_nodes') : t('dialogMap.collapse_nodes')} placement="top">
            <CollapseButton onClick={handleCollapseClick} $isCollapsed={isCollapsed}>
              {isCollapsed ? data.childrenCount : <MinusOutlined />}
            </CollapseButton>
          </Tooltip>
        )}

        {/* 为主节点内容单独添加Tooltip */}
        <Tooltip
          title={tooltipTitle}
          placement="top"
          color="rgba(0, 0, 0, 0.85)"
          mouseEnterDelay={0.2}
          mouseLeaveDelay={0.1}
          destroyTooltipOnHide>
          <CustomNodeContainer
            style={{
              borderColor,
              background: `linear-gradient(135deg, ${backgroundColor} 0%, ${gradientColor} 100%)`,
              boxShadow: `0 4px 10px rgba(0, 0, 0, 0.1), 0 0 0 2px ${borderColor}40`,
              height: isCombined ? '160px' : '100px' // 调整合并模式下的高度
            }}
            onClick={handleNodeClick}
            $isSelected={isSelected}
            $borderColor={borderColor}>
            <Handle type="target" position={Position.Top} style={handleStyle} isConnectable={false} />
            <Handle type="target" position={Position.Left} style={handleStyle} isConnectable={false} />
            <Handle type="target" position={Position.Right} style={handleStyle} isConnectable={false} />
            <Handle type="target" position={Position.Bottom} style={handleStyle} isConnectable={false} />

            {isCombined ? (
              <>
                {/* 合并模式UI - 同时显示用户提问和模型回答，使用统一样式 */}
                <CombinedNodeContent>
                  <UserContentSection>
                    <CompactMessageRow>
                      <Avatar icon={<UserOutlined />} style={{ backgroundColor: 'var(--color-link)' }} size={22} />
                      <CompactContent className="user-content">{userContent}</CompactContent>
                    </CompactMessageRow>
                  </UserContentSection>

                  <Divider style={{ margin: '4px 0' }} />

                  <ModelSection>
                    <CompactMessageRow>
                      {getModelAvatar()}
                      <CompactContent>{data.content}</CompactContent>
                    </CompactMessageRow>
                  </ModelSection>
                </CombinedNodeContent>
              </>
            ) : (
              <>
                {/* 单节点模式UI */}
                <CompactMessageRow>
                  {nodeType === 'user' ? (
                    <Avatar icon={<UserOutlined />} style={{ backgroundColor: 'var(--color-link)' }} size={22} />
                  ) : (
                    getModelAvatar()
                  )}
                  <CompactContent>{data.content}</CompactContent>
                </CompactMessageRow>
              </>
            )}

            <Handle type="source" position={Position.Bottom} style={handleStyle} isConnectable={false} />
            <Handle type="source" position={Position.Right} style={handleStyle} isConnectable={false} />
            <Handle type="source" position={Position.Left} style={handleStyle} isConnectable={false} />
            <Handle type="source" position={Position.Top} style={handleStyle} isConnectable={false} />
          </CustomNodeContainer>
        </Tooltip>
      </NodeWrapper>
    </Dropdown>
  )
}

// 样式组件定义
interface CustomNodeContainerProps {
  $isSelected: boolean
  $borderColor: string
}

const CustomNodeContainer = styled.div<CustomNodeContainerProps>`
  padding: 12px;
  border-radius: 10px;
  border: 2px solid;
  width: 240px;
  height: 100px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease-in-out;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  ${(props) =>
    props.$isSelected &&
    `
    box-shadow: 0 0 0 3px var(--color-primary-soft) !important;
    transform: scale(1.02);
  `}

  &:hover {
    transform: translateY(-2px);
    box-shadow:
      0 6px 10px var(--color-border-soft),
      0 0 0 2px ${(props) => props.$borderColor || 'var(--color-border)'}40 !important;
    filter: brightness(1.02);
  }

  /* 添加点击动画效果 */
  &:active {
    transform: scale(0.98);
    box-shadow: 0 2px 4px var(--color-border-soft);
    transition: all 0.1s ease;
  }
`

// 定义提示框样式组件
const TooltipContent = styled.div`
  max-width: 300px;
`

const TooltipTitle = styled.div`
  font-weight: bold;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding-bottom: 4px;
`

const TooltipBody = styled.div`
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 8px;
  white-space: pre-wrap;
`

const TooltipFooter = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  font-style: italic;
`

// 添加新的样式组件
const CombinedNodeContent = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`

const UserContentSection = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0;
`

const ModelSection = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0;
`

const CompactMessageRow = styled.div`
  display: flex;
  align-items: flex-start;
  padding: 4px;
  gap: 8px;
`

const CompactContent = styled.div`
  flex: 1;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: ${(props) => (props.className === 'user-content' ? '2' : '3')};
  -webkit-box-orient: vertical;
  line-height: 1.5;
  word-break: break-word;
  font-size: 15px;
  position: relative;
`

const AddBranchButtonContainer = styled.div`
  position: absolute;
  top: 50%;
  right: -40px;
  transform: translateY(-50%);
  z-index: 10;
`

const AddBranchButtonOutside = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 12px;
  background-color: var(--color-primary);
  color: white;
  border: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    transform: scale(1.1);
    background-color: var(--color-primary-dark);
  }

  &:active {
    transform: scale(0.95);
  }
`

const BranchArrow = styled.div`
  position: absolute;
  top: 50%;
  right: 24px;
  width: 20px;
  height: 0;
  border-top: 2px dashed var(--color-primary);
  transform: translateY(-50%);

  &:before {
    content: '';
    position: absolute;
    right: 0;
    top: -4px;
    width: 0;
    height: 0;
    border-style: solid;
    border-width: 3px 0 3px 6px;
    border-color: transparent transparent transparent var(--color-primary);
  }
`

const Divider = styled.hr`
  border: none;
  border-top: 1px dashed rgba(0, 0, 0, 0.15);
  margin: 4px 0;
  width: 100%;
`

const NodeWrapper = styled.div`
  position: relative;
  width: 240px;
  height: 160px;
  display: flex;
  justify-content: center;
  align-items: center;
`

const CollapseButton = styled.div<{ $isCollapsed: boolean }>`
  position: absolute;
  top: calc(50% + 40px);
  right: -40px;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  border-radius: 12px;
  background-color: var(--color-bg-1);
  border: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 10;
  font-size: ${(props) => (props.$isCollapsed ? '12px' : '14px')};
  color: var(--color-text);
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--color-bg-2);
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  &:active {
    transform: translateY(-50%) scale(0.95);
  }
`

export default DialogMapNode
