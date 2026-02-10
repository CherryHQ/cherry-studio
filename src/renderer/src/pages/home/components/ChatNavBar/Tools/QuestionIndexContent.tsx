import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { MessageBlockType } from '@renderer/types/newMessage'
import { Empty, List, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import {
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Terminal,
  Video
} from 'lucide-react'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

const { Text } = Typography

interface Props {
  onItemClick?: () => void
}

/**
 * 问题索引组件
 * 参考 MessageBlockRenderer 的逻辑，通过 Redux 实体库获取消息内容
 */
const QuestionIndexContent: FC<Props> = ({ onItemClick }) => {
  const { chat } = useRuntime()
  const { t } = useTranslation()

  // 核心逻辑：从 Redux 获取所有 Block 实体，解决 msg.content 不存在的问题
  const blockEntities = useSelector((state: any) => messageBlocksSelectors.selectEntities(state))

  const messages = useTopicMessages(chat.activeTopic?.id ?? "")
  const questionList = useMemo(() => {
    if (!messages) return []

    return messages
      .filter((msg) => msg.role === 'user') // 只筛选用户的提问
      .map((msg) => {
        // 这里的 blocks 是 ID 数组，需要去实体表里查
        const blockIds = (msg as any).blocks || []
        const blocks = blockIds.map((id: string) => blockEntities[id]).filter(Boolean)

        let displayTitle = ''
        let icon = <MessageSquare size={14} className="opacity-40" />

        // 1. 优先提取文本内容作为标题 (MAIN_TEXT)
        const mainTextBlock = blocks.find(b => b.type === MessageBlockType.MAIN_TEXT)
        if (mainTextBlock?.content) {
          displayTitle = mainTextBlock.content
        }

        // 2. 状态检查：是否包含多媒体区块
        const hasImage = blocks.some(b => b.type === MessageBlockType.IMAGE)
        const hasFile = blocks.some(b => b.type === MessageBlockType.FILE)
        const hasCode = blocks.some(b => b.type === MessageBlockType.CODE)
        const hasVideo = blocks.some(b => b.type === MessageBlockType.VIDEO)

        // 3. 兜底逻辑：如果没有文字，显示类型名称（如 [图片]）
        if (!displayTitle.trim()) {
          if (hasImage) displayTitle = t('common.image') || '图片提问'
          else if (hasFile) displayTitle = t('common.file') || '文件咨询'
          else if (hasCode) displayTitle = '代码片段提问'
          else if (hasVideo) displayTitle = '视频内容'
          else displayTitle = '点击查看详情'
        }

        // 4. 根据内容类型动态更换图标
        if (hasImage) icon = <ImageIcon size={14} className="text-blue-500" />
        else if (hasFile) icon = <FileText size={14} className="text-orange-500" />
        else if (hasCode) icon = <Terminal size={14} className="text-purple-500" />
        else if (hasVideo) icon = <Video size={14} className="text-red-500" />

        return {
          id: msg.id,
          title: displayTitle,
          icon: icon,
          hasImage,
          hasFile,
          hasCode,
          time: mainTextBlock.createdAt
        }
      })
      .filter((item) => item.title.trim() !== '')
  }, [chat.activeTopic?.messages, blockEntities, t])

  // 滚动至对应的消息位置
  // QuestionIndexContent.tsx
  const scrollToMessage = (id: string) => {
    // 1. 发送信号让 Messages 组件确保这个 ID 的 DOM 被创建出来
    EventEmitter.emit(EVENT_NAMES.ENSURE_MESSAGE_RENDERED, id);

    // 2. 轮询等待 DOM 出现并滚动
    let attempts = 0;
    const checkAndScroll = () => {
      const element = document.getElementById(`message-${id}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (attempts < 10) {
        attempts++;
        setTimeout(checkAndScroll, 100); // 每 100ms 检查一次，共 1 秒
      }
    };

    checkAndScroll();
    onItemClick?.();
  };

  console.log("questionList:", questionList);
  if (questionList.length === 0) {
    return (
      <EmptyContainer>
        <Empty description={t('chat.questions.no_questions')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </EmptyContainer>
    )
  }

  return (
    <ListContainer>
      <List
        dataSource={questionList}
        renderItem={(item, index) => (
          <IndexItem onClick={() => scrollToMessage(item.id)}>
            <div className="flex gap-3 w-full items-start">
              <IconWrapper>{item.icon}</IconWrapper>
              <div className="flex-1 min-w-0">
                <MetaHeader>
                  <span className="index-num">#{index + 1}</span>
                  <TagBox>
                    {item.hasImage && <Tag color="blue">IMG</Tag>}
                    {item.hasFile && <Tag color="orange">FILE</Tag>}
                    {item.hasCode && <Tag color="purple">CODE</Tag>}
                  </TagBox>
                  <span className="index-num">{dayjs(item.time).format('MM/DD HH:mm')}</span>
                </MetaHeader>
                <TitleText ellipsis={{ tooltip: item.title }}>
                  {item.title}
                </TitleText>
              </div>
            </div>
          </IndexItem>
        )}
      />
    </ListContainer>
  )
}

// --- 样式部分 (使用 Styled Components) ---

const ListContainer = styled.div`
  height: 100%;
  overflow-y: auto;
  background: var(--color-bg-1);
`

const EmptyContainer = styled.div`
  padding: 60px 0;
  text-align: center;
`

const IndexItem = styled(List.Item)`
  cursor: pointer;
  padding: 12px 16px !important;
  transition: background 0.2s;
  border-bottom: 1px solid var(--color-border-soft) !important;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
    .dark & {
      background: rgba(255, 255, 255, 0.06);
    }
  }
`

const IconWrapper = styled.div`
  margin-top: 4px;
  width: 20px;
  display: flex;
  justify-content: center;
`

const MetaHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  
  .index-num {
    font-size: 11px;
    font-family: monospace;
    color: var(--color-text-3);
  }
`

const TagBox = styled.div`
  display: flex;
  gap: 4px;
  .ant-tag {
    margin: 0;
    font-size: 9px;
    line-height: 14px;
    padding: 0 4px;
    border: none;
  }
`

const TitleText = styled(Text)`
  font-size: 13px;
  color: var(--color-text-1);
  line-height: 1.5;
  display: block;
`

export default QuestionIndexContent