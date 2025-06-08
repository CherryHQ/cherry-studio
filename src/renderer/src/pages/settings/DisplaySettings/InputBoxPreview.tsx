import { HolderOutlined } from '@ant-design/icons'
import { useAppDispatch } from '@renderer/store'
import { setInputBoxIconsConfig } from '@renderer/store/settings'
import { Input, Tooltip } from 'antd'
import { FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { CSSProperties } from 'styled-components'

import InputBoxIconsManager from './InputBoxIconsManager'
import { getInputBoxIcons, getVisibleInputBoxIcons, sortIconsByPosition } from './inputBoxIconsUtils'

const { TextArea } = Input

interface Props {
  inputBoxConfig: Record<string, { visible: boolean; position: 'left' | 'right'; order: number }>
  setInputBoxConfig: (config: Record<string, { visible: boolean; position: 'left' | 'right'; order: number }>) => void
}

const InputBoxPreview: FC<Props> = ({ inputBoxConfig, setInputBoxConfig }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [isExpanded, setIsExpanded] = useState(false)
  const [previewText, setPreviewText] = useState('')

  // 获取所有输入框图标 - 使用 useMemo 缓存
  const allIcons = useMemo(() => getInputBoxIcons(), [])

  // 模拟一些条件状态用于预览
  const mockConditions = useMemo(
    () => ({
      showThinkingButton: true,
      showKnowledgeIcon: true,
      hasMcpServers: true,
      isGenerateImageModel: false,
      showInputEstimatedTokens: true
    }),
    []
  )

  // 获取可见的图标并应用配置 - 使用 useMemo 优化性能
  const { leftIcons, rightIcons } = useMemo(() => {
    // 获取可见的图标
    const visibleIcons = getVisibleInputBoxIcons(allIcons, mockConditions)

    // 应用用户的自定义配置
    const configuredIcons = visibleIcons
      .map((icon) => ({
        ...icon,
        visible: inputBoxConfig?.[icon.id]?.visible ?? icon.visible,
        order: inputBoxConfig?.[icon.id]?.order ?? icon.order,
        position: inputBoxConfig?.[icon.id]?.position ?? icon.position
      }))
      .filter((icon) => icon.visible)

    // 按位置排序
    return sortIconsByPosition(configuredIcons)
  }, [allIcons, mockConditions, inputBoxConfig])

  // 更新配置的回调函数
  const handleConfigUpdate = (
    newConfig: Record<string, { visible: boolean; position: 'left' | 'right'; order: number }>
  ) => {
    setInputBoxConfig(newConfig)
    dispatch(setInputBoxIconsConfig(newConfig))
  }

  const textareaRows = isExpanded ? 6 : 3

  const TextareaStyle: CSSProperties = {
    paddingLeft: 0,
    padding: '6px 15px 8px'
  }

  const handleExpandToggle = () => {
    setIsExpanded(!isExpanded)
  }

  return (
    <Container>
      <PreviewLabel>{t('settings.display.inputbox.preview')}</PreviewLabel>
      <PreviewContainer>
        <InputBarContainer className="inputbar-container">
          <DragHandle>
            <HolderOutlined />
          </DragHandle>
          <Textarea
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            placeholder={t('chat.input.placeholder')}
            variant="borderless"
            spellCheck={false}
            rows={textareaRows}
            styles={{ textarea: TextareaStyle }}
          />
          <Toolbar>
            <ToolbarMenu>
              {leftIcons.map((icon) => (
                <Tooltip key={icon.id} title={t(icon.tooltip)} placement="top">
                  <ToolbarButton onClick={icon.id === 'expand_collapse' ? handleExpandToggle : undefined}>
                    {icon.id === 'expand_collapse' ? (isExpanded ? icon.icon : icon.icon) : icon.icon}
                  </ToolbarButton>
                </Tooltip>
              ))}
            </ToolbarMenu>
            <ToolbarMenu>
              {rightIcons.map((icon) => (
                <Tooltip key={icon.id} title={t(icon.tooltip)} placement="top">
                  <ToolbarButton>{icon.icon}</ToolbarButton>
                </Tooltip>
              ))}
            </ToolbarMenu>
          </Toolbar>
        </InputBarContainer>
      </PreviewContainer>
      <InputBoxIconsManager icons={allIcons} inputBoxConfig={inputBoxConfig} setInputBoxConfig={handleConfigUpdate} />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`

const PreviewLabel = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  margin-bottom: 8px;
`

const PreviewContainer = styled.div`
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 2;
  padding: 20px;
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  background-color: var(--color-background-soft);
  width: 100%;
`

const InputBarContainer = styled.div`
  border: 0.5px solid var(--color-border);
  transition: all 0.2s ease;
  position: relative;
  border-radius: 15px;
  padding-top: 6px;
  background-color: var(--color-background-opacity);
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
`

const DragHandle = styled.div`
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: row-resize;
  color: var(--color-icon);
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 1;

  &:hover {
    opacity: 1;
  }

  .anticon {
    transform: rotate(90deg);
    font-size: 14px;
  }
`

const Textarea = styled(TextArea)`
  padding: 0;
  border-radius: 0;
  display: flex;
  flex: 1;
  font-family: Ubuntu;
  resize: none !important;
  overflow: auto;
  width: 100%;
  box-sizing: border-box;
  &.ant-input {
    line-height: 1.4;
  }
`

const Toolbar = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 0 8px;
  padding-bottom: 0;
  margin-bottom: 4px;
  height: 36px;
`

const ToolbarMenu = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
`

const ToolbarButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-icon);
  transition: all 0.2s;

  &:hover {
    background-color: var(--color-background-soft);
    color: var(--color-text-1);
  }

  &:active {
    transform: scale(0.95);
  }

  .iconfont {
    font-size: inherit;
  }
`

export default InputBoxPreview
