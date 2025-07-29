import { useTheme } from '@renderer/context/ThemeProvider'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import { Assistant, Topic } from '@renderer/types'
import { containsSupportedVariables } from '@renderer/utils/prompt'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  topic?: Topic
}

const Prompt: FC<Props> = ({ assistant, topic }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const prompt = assistant.prompt || t('chat.default.description')
  const topicPrompt = topic?.prompt || ''
  const isDark = theme === 'dark'

  const processedPrompt = usePromptProcessor({ prompt, modelName: assistant.model?.name })

  // 用于控制显示的状态
  const [displayText, setDisplayText] = useState(prompt)
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    // 如果没有变量需要替换，直接显示处理后的内容
    if (!containsSupportedVariables(prompt)) {
      setDisplayText(processedPrompt)
      setIsVisible(true)
      return
    }

    // 如果有变量需要替换，先显示原始prompt
    setDisplayText(prompt)
    setIsVisible(true)

    // 延迟过渡
    let innerTimer: NodeJS.Timeout
    const outerTimer = setTimeout(() => {
      // 先淡出
      setIsVisible(false)

      // 切换内容并淡入
      innerTimer = setTimeout(() => {
        setDisplayText(processedPrompt)
        setIsVisible(true)
      }, 300)
    }, 300)

    return () => {
      clearTimeout(outerTimer)
      clearTimeout(innerTimer)
    }
  }, [prompt, processedPrompt])

  if (!prompt && !topicPrompt) {
    return null
  }

  return (
    <Container className="system-prompt" onClick={() => AssistantSettingsPopup.show({ assistant })} $isDark={isDark}>
      <Text $isVisible={isVisible}>{displayText}</Text>
    </Container>
  )
}

const Container = styled.div<{ $isDark: boolean }>`
  padding: 11px 16px;
  border-radius: 10px;
  cursor: pointer;
  border: 0.5px solid var(--color-border);
  margin: 15px 24px;
  margin-bottom: 0;
`

const Text = styled.div<{ $isVisible: boolean }>`
  color: var(--color-text-2);
  font-size: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  user-select: none;

  opacity: ${(props) => (props.$isVisible ? 1 : 0)};
  transition: opacity 0.3s ease-in-out;
`

export default Prompt
