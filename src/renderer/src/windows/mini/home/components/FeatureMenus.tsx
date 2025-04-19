import { BulbOutlined, EnterOutlined, FileTextOutlined, MessageOutlined, TranslationOutlined, SendOutlined, EditOutlined } from '@ant-design/icons'
// import Scrollbar from '@renderer/components/Scrollbar' // Keep commented out or remove if not used
// 引入 Divider 和 EmojiIcon (假设存在或直接用 span)
// 引入 Input 和 Button 用于编辑
import { Col, Divider, Input, Button } from 'antd'
import React, { Dispatch, SetStateAction, useImperativeHandle, useMemo, useState, useEffect, Fragment } from 'react' // 引入 React 和 Fragment
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
// 假设 EmojiIcon 组件存在
// import EmojiIcon from '@renderer/components/EmojiIcon' // 假设 EmojiIcon 组件存在

// --- 更明确的类型定义 ---
interface CustomAction {
  id: string
  emoji: string
  name: string
  prompt: string // 包含 【holderplace】
}

// 普通菜单项类型
type FeatureItemType = {
  key: string;
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  type?: 'feature'; // 添加可选的 type 属性，用于区分
  active?: boolean; // 添加 active 属性，用于固定菜单项
};

// 分隔符项类型
type DividerItemType = {
  type: 'divider';
  key: string;
};

// 组合类型
type CombinedFeature = FeatureItemType | DividerItemType;
// --- 结束类型定义 ---


interface FeatureMenusProps {
  text: string
  setRoute: Dispatch<SetStateAction<'translate' | 'summary' | 'chat' | 'explanation' | 'home'>>
  onSendMessage: (prompt?: string) => void
}

export interface FeatureMenusRef {
  nextFeature: () => void
  prevFeature: () => void
  useFeature: () => void
  resetSelectedIndex: () => void
}

// 模拟的自定义操作数据 (最终需要从配置或 IPC 获取)
const mockCustomActions: CustomAction[] = [
  { id: '1', emoji: '📝', name: '格式化为JSON', prompt: `Act as a natural language processing software. Analyze the given text and return me only a parsable and minified JSON object.


Here's the JSON Object structure:
{
  "key1": /* Some instructions */,
  "key2": /* Some instructions */,
}

Here are the rules you must follow:
- You MUST return a valid, parsable JSON object.
- More rules…

Here are some examples to help you out:
- Example 1…
- Example 2…

Text: 【holderplace】

JSON Data:\n\n` },
  { id: '2', emoji: '💡', name: '正则生成', prompt: `Generate a regular expression that match the specific patterns in the text. Return the regular expression in a format that can be easily copied and pasted into a regex-enabled text editor or programming language. Then, give clear and understandable explanations on what the regex is doing and how it is constructed.

Text: 【holderplace】

Regex:` },
  { id: '3', emoji: '📧', name: 'DEBUG代码生成', prompt: `Act as a software engineer debugging its code. Add debug statements to the code. Add as many as necessary to make debugging easier.

Code: 【holderplace】

Debugged code:` }
]

const FeatureMenus = ({
  ref,
  text,
  setRoute,
  onSendMessage
}: FeatureMenusProps & { ref?: React.RefObject<FeatureMenusRef | null> }) => {
  const { t } = useTranslation()
  const [selectedIndex, setSelectedIndex] = useState(0)
  // TODO: 替换为实际获取自定义操作的逻辑
  const [customActions, setCustomActions] = useState<CustomAction[]>(mockCustomActions)
  const [editingActionId, setEditingActionId] = useState<string | null>(null) // State to track the action being edited
  const [editFormData, setEditFormData] = useState<Partial<CustomAction>>({}) // State for edit form data

  // Handler for changes in the edit form inputs
  const handleEditFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setEditFormData(prev => ({ ...prev, [name]: value }))
  }

  // Handler for saving the edited action
  const handleSaveEdit = () => {
    if (!editingActionId) return
    // TODO: Implement actual saving logic (e.g., IPC call to main process)
    console.log('Saving action:', editFormData)
    // Update the customActions state (for now, just update mock data)
    setCustomActions(prev =>
      prev.map(action =>
        action.id === editingActionId ? { ...action, ...editFormData } as CustomAction : action
      )
    )
    setEditingActionId(null) // Exit edit mode
  }

  // Handler for canceling the edit
  const handleCancelEdit = () => {
    setEditingActionId(null)
    setEditFormData({})
  }

  // useEffect(() => {
  //   // 示例：通过 IPC 获取数据
  //   window.electron.ipcRenderer.invoke('get-custom-actions').then(actions => {
  //     setCustomActions(actions || [])
  //   })
  // }, [])

  const fixedFeatures = useMemo(
    (): FeatureItemType[] => [ // 显式标注类型
      {
        key: 'chat',
        icon: <MessageOutlined style={{ fontSize: '16px', color: 'var(--color-text)' }} />,
        title: t('miniwindow.feature.chat'),
        active: true, // 保留 active 用于可能的样式区分
        onClick: () => {
          if (text) {
            setRoute('chat')
            onSendMessage()
          }
        }
      },
      {
        key: 'translate',
        icon: <TranslationOutlined style={{ fontSize: '16px', color: 'var(--color-text)' }} />,
        title: t('miniwindow.feature.translate'),
        onClick: () => text && setRoute('translate')
      },
      {
        key: 'summary',
        icon: <FileTextOutlined style={{ fontSize: '16px', color: 'var(--color-text)' }} />,
        title: t('miniwindow.feature.summary'),
        onClick: () => {
          if (text) {
            setRoute('summary')
            onSendMessage(t('prompts.summarize'))
          }
        }
      },
      {
        key: 'explanation',
        icon: <BulbOutlined style={{ fontSize: '16px', color: 'var(--color-text)' }} />,
        title: t('miniwindow.feature.explanation'),
        onClick: () => {
          if (text) {
            setRoute('explanation')
            onSendMessage(t('prompts.explanation'))
          }
        }
      },
      // {
      //   key: 'directSend',
      //   icon: <SendOutlined style={{ fontSize: '16px', color: 'var(--color-text)' }} />,
      //   title: t('miniwindow.feature.directSend'), // 需要添加对应的翻译
      //   onClick: () => {
      //     if (text) {
      //       setRoute('chat')
      //       // 注意：这里的 holderReplace 似乎与用户要求的 【holderplace】 不同，暂时保留原样
      //       onSendMessage('你要根据如下内容写一首诗歌发送给我。这首歌的标题是【【holderReplace】】，请你根据这个标题做首歌')
      //     }
      //   }
      // }
    ],
    [onSendMessage, setRoute, t, text]
  )

  const allFeatures = useMemo((): CombinedFeature[] => { // 显式标注 allFeatures 类型
    const customFeatureItems: FeatureItemType[] = customActions.map((action) => ({ // 显式标注 customFeatureItems 类型
      key: action.id,
      // 使用 span 显示 Emoji，如果 EmojiIcon 组件可用，则替换
      icon: <span style={{ fontSize: '16px' }}>{action.emoji}</span>, // 使用 span 显示 Emoji
      // icon: <EmojiIcon emoji={action.emoji} size={16} />,
      title: action.name,
      onClick: () => {
        if (text) {
          const finalPrompt = action.prompt.replace('【holderplace】', text)
          setRoute('chat')
          onSendMessage(finalPrompt)
        }
      }
    }))
    return [...fixedFeatures, ...(customFeatureItems.length > 0 ? [{ type: 'divider' as const, key: 'divider' }, ...customFeatureItems] : [])]
  }, [fixedFeatures, customActions, text, setRoute, onSendMessage])


  useImperativeHandle(ref, () => ({
    nextFeature() {
      setSelectedIndex((prev) => {
        let nextIndex = prev + 1
        // 跳过分隔符，并确保访问的不是 undefined
        while (nextIndex < allFeatures.length && allFeatures[nextIndex]?.type === 'divider') {
          nextIndex++
        }
        // 如果超出范围，回到第一个非分隔符项
        if (nextIndex >= allFeatures.length) {
            nextIndex = 0;
            while (nextIndex < allFeatures.length && allFeatures[nextIndex]?.type === 'divider') {
                nextIndex++;
            }
        }
        return nextIndex >= allFeatures.length ? 0 : nextIndex // Fallback if all are dividers (unlikely)
      })
    },
    prevFeature() {
      setSelectedIndex((prev) => {
        let prevIndex = prev - 1
        // 跳过分隔符，并确保访问的不是 undefined
        while (prevIndex >= 0 && allFeatures[prevIndex]?.type === 'divider') {
          prevIndex--
        }
        // 如果超出范围，回绕到最后一个非分隔符项
        if (prevIndex < 0) {
            prevIndex = allFeatures.length - 1;
             while (prevIndex >= 0 && allFeatures[prevIndex]?.type === 'divider') {
                prevIndex--;
            }
        }
        return prevIndex < 0 ? allFeatures.length - 1 : prevIndex // Fallback if all are dividers
      })
    },
    useFeature() {
      const feature = allFeatures[selectedIndex]
      // 添加类型守卫，确保 feature 不是分隔符且 onClick 存在
      if (feature && feature.type !== 'divider' && feature.onClick) {
        feature.onClick()
      }
    },
    resetSelectedIndex() {
      setSelectedIndex(0)
    }
  }))

  return (
    <FeatureList>
      <FeatureListWrapper>
        {allFeatures.map((feature, index) => {
          if (feature.type === 'divider') {
            // 可以添加一个带文本的 Divider，如果需要标题的话
            return <StyledDivider key={feature.key} />
            // return <DividerWithText key={feature.key}>{t('miniwindow.feature.customActions')}</DividerWithText> // 假设有 DividerWithText 组件
          }
          // Use presence of 'onClick' as a type guard for FeatureItemType
          if ('onClick' in feature) {
            return (
              // 使用 Fragment 并将 key 移到这里
              <Fragment key={feature.key}>
                {/* Now TypeScript knows feature is FeatureItemType here */}
                <FeatureItem
                  onClick={feature.onClick}
                  className={index === selectedIndex ? 'active' : ''}
                  $isCustom={customActions.some(a => a.id === feature.key)}
                >
                  <FeatureIcon>{feature.icon}</FeatureIcon>
                  <FeatureTitle>{feature.title}</FeatureTitle>
                  {index === selectedIndex && !editingActionId && <EnterOutlined />}
                  {customActions.some(a => a.id === feature.key) && (
                    <EditButton
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingActionId(feature.key)
                        const action = customActions.find(a => a.id === feature.key)
                        if (action) {
                          setEditFormData({
                            id: action.id,
                            emoji: action.emoji,
                            name: action.name,
                            prompt: action.prompt
                          })
                        }
                      }}
                    />
                  )}
                </FeatureItem>
                {/* 如果当前项是正在编辑的项，则渲染编辑表单 */}
                {editingActionId === feature.key && (
                  <EditFormWrapper>
                    <Col span={24}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
                        {t('miniwindow.edit.emojiLabel', 'Emoji')}
                      </label>
                      <Input
                        name="emoji"
                        placeholder={t('miniwindow.edit.emojiPlaceholder', 'Emoji')}
                        value={editFormData.emoji || ''}
                        onChange={handleEditFormChange}
                        maxLength={2}
                        style={{ width: '60px', marginRight: '8px' }}
                      />
                    </Col>
                    <Col span={24}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
                        {t('miniwindow.edit.nameLabel', '名称')}
                      </label>
                      <Input
                        name="name"
                        placeholder={t('miniwindow.edit.namePlaceholder', '名称')}
                        value={editFormData.name || ''}
                        onChange={handleEditFormChange}
                        style={{ flexGrow: 1, marginRight: '8px' }}
                      />
                    </Col>
                    <Col span={24}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
                        {t('miniwindow.edit.promptLabel', '提示词')}
                      </label>
                      <Input.TextArea
                        name="prompt"
                        placeholder={t('miniwindow.edit.promptPlaceholder', '提示词')}
                        value={editFormData.prompt || ''}
                        onChange={handleEditFormChange}
                        rows={3}
                        style={{ marginTop: 0, width: '100%' }}
                      />
                    </Col>
                    <EditFormActions>
                      <Button size="small" onClick={handleCancelEdit}>
                        {t('common.cancel', '取消')} {/* 使用通用翻译键 + 默认值 */}
                      </Button>
                      <Button type="primary" size="small" onClick={handleSaveEdit}>
                        {t('common.save', '保存')} {/* 使用通用翻译键 + 默认值 */}
                      </Button>
                    </EditFormActions>
                  </EditFormWrapper>
                )}
              </Fragment>
            )
          }
          // Should not happen if the divider case is handled above, but good for type safety
          return null;
        })}
      </FeatureListWrapper>
    </FeatureList>
  )
}
FeatureMenus.displayName = 'FeatureMenus'

export default React.forwardRef(FeatureMenus)

// 改为普通 div，不负责滚动，高度自适应
const FeatureList = styled.div`
  height: 400px; /* 设置固定高度 */
  overflow-y: auto; /* 添加垂直滚动 */
  -webkit-app-region: none;
  padding-right: 8px; /* 为滚动条留出空间 */

  /* 自定义滚动条样式 */
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background-color: var(--color-border);
    border-radius: 3px;
  }
  &::-webkit-scrollbar-track {
    background-color: transparent;
  }
`

const FeatureListWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  cursor: pointer;
  padding-right: 4px; // 为滚动条留出空间
`

interface FeatureItemProps {
  $isCustom?: boolean;
}

const FeatureItem = styled.div<FeatureItemProps>`
  cursor: pointer;
  transition: background-color 0s;
  background: transparent;
  border: none;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  -webkit-app-region: none;
  position: relative;
  border-radius: 8px;
  user-select: none;

  &:hover {
    background: var(--color-background-mute);
  }

  &.active {
    background: var(--color-background-mute);
  }
`

const FeatureIcon = styled.div`
  // 移除 color: #fff; 让图标颜色继承或由 style 控制
  display: flex; // 确保图标居中（如果需要）
  align-items: center;
`

const FeatureTitle = styled.h3`
  margin: 0;
  font-size: 14px;
  flex-grow: 1; // 替换 flex-basis，让标题占据剩余空间
  white-space: nowrap; // 防止标题换行
  overflow: hidden;
  text-overflow: ellipsis; // 超出显示省略号
`

// 添加 Divider 样式
const StyledDivider = styled(Divider)`
  margin: 8px 0; // 调整分隔线上下的间距
  border-color: var(--color-border); // 使用 CSS 变量定义颜色
`

// 添加编辑表单的样式
const EditFormWrapper = styled.div`
  padding: 10px 16px;
  background-color: var(--color-background-soft); // Use a slightly different background
  border-radius: 8px;
  margin-top: 5px; // Add some space above the form
  display: flex;
  flex-wrap: wrap; // Allow items to wrap
  align-items: center;
`

const EditButton = styled(Button)`
  opacity: 0;
  transition: opacity 0.2s;
  position: absolute;
  right: 16px;

  ${FeatureItem}:hover & {
    opacity: 1;
  }
`

const EditFormActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%; // Take full width
  margin-top: 10px; // Space above buttons
`

