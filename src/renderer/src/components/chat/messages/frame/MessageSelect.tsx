import { Checkbox } from '@cherrystudio/ui'
import { useChatContext } from '@renderer/hooks/useChatContext'
import type { Topic } from '@renderer/types'
import type { FC, ReactNode } from 'react'
import { useEffect, useRef } from 'react'

interface SelectableMessageProps {
  children: ReactNode
  messageId: string
  topic: Topic
  isClearMessage?: boolean
}

const SelectableMessage: FC<SelectableMessageProps> = ({ children, messageId, topic, isClearMessage = false }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const {
    registerMessageElement: contextRegister,
    isMultiSelectMode,
    selectedMessageIds,
    handleSelectMessage
  } = useChatContext(topic)

  const isSelected = selectedMessageIds?.includes(messageId)

  useEffect(() => {
    if (containerRef.current) {
      contextRegister(messageId, containerRef.current)
      return () => {
        contextRegister(messageId, null)
      }
    }
    return undefined
  }, [messageId, contextRegister])

  return (
    <div ref={containerRef} className="relative flex w-full">
      {isMultiSelectMode && !isClearMessage && (
        <div className="-mr-2.5 flex items-start px-0 pt-5.5 pb-2.5 pl-5">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => handleSelectMessage(messageId, checked === true)}
          />
        </div>
      )}
      <div className={`min-w-0 flex-1 ${isMultiSelectMode ? 'ml-2' : ''}`}>{children}</div>
    </div>
  )
}

export default SelectableMessage
