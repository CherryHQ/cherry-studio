import { useAssistant } from '@renderer/hooks/useAssistant'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import AssistantSettingsPopup from '@renderer/pages/home/AssistantSettings'
import type { Topic } from '@renderer/types'
import { containsSupportedVariables } from '@renderer/utils/prompt'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  topic: Topic
}

const Prompt: FC<Props> = ({ topic }) => {
  const { t } = useTranslation()
  const { assistant, model } = useAssistant(topic.assistantId)

  const prompt = assistant?.prompt || t('chat.default.description')
  const topicPrompt = topic.prompt || ''

  const processedPrompt = usePromptProcessor({ prompt, modelName: model?.name })

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
    <div
      className="system-prompt mx-5 mt-[15px] mb-0 cursor-pointer rounded-[10px] border-(--color-border) border-[0.5px] px-4 py-[11px]"
      onClick={() => assistant && AssistantSettingsPopup.show({ assistant, tab: 'prompt' })}>
      <div
        className="select-none overflow-hidden text-(--color-text-2) text-xs transition-opacity duration-300 ease-in-out [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]"
        style={{ opacity: isVisible ? 1 : 0 }}>
        {displayText}
      </div>
    </div>
  )
}

export default Prompt
