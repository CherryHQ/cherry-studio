import { KnowledgeBase, Model } from '@renderer/types'
import { List } from 'antd'
import { t } from 'i18next'
import { CSSProperties, FC, useEffect, useRef, useState } from 'react'

import SelectAtActionKnowledge from './SelectAtActionKnowledge'
import SelectAtActionModel from './SelectAtActionModel'

interface Action {
  name: string
  type: ActionType
}

interface Props {
  onMentionModel: (model: Model, fromKeyboard: boolean) => void
  mentionModels: Model[]
  selectedKnowledgeBases: KnowledgeBase[]
  handleKnowledgeBaseSelect: (bases: KnowledgeBase[]) => void
  onClose: () => void
}

type ActionType = 'model' | 'knowledge_base' | 'mcp'

const data: Action[] = [
  {
    name: t('chat.actions.model'),
    type: 'model'
  },
  {
    name: t('chat.actions.knowledge_base'),
    type: 'knowledge_base'
  }
]

export const SelectAtAction: FC<Props> = ({
  onMentionModel,
  mentionModels,
  selectedKnowledgeBases,
  handleKnowledgeBaseSelect,
  onClose
}) => {
  const listRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [selectModelActionShow, setSelectModelActionShow] = useState(false)
  const [selectKnowledgeActionShow, setSelectKnowlegdeActionShow] = useState(false)
  const [isShow, setIsShow] = useState(true)
  useEffect(() => {
    const listElement = listRef.current
    if (listElement && isShow) {
      // 获取内容的实际高度
      listElement.style.display = 'block'
      const height = listElement.scrollHeight
      listElement.style.height = '0'
      // 触发重绘
      void listElement.offsetHeight
      listElement.style.height = `${height}px`
    }
  }, [isShow])

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (!isShow) return
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(0, prev - 1))
          break
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => Math.min(data.length - 1, prev + 1))
          break
        case 'Enter':
          e.preventDefault()
          handleItemSelect(data[selectedIndex].type)
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          setIsShow(false)
          setSelectModelActionShow(false)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isShow, setIsShow, selectedIndex])

  // Function to handle item selection and print the type
  const handleItemSelect = (type: ActionType) => {
    switch (type) {
      case 'model':
        console.log('Selected type: model')
        setSelectModelActionShow(true)
        setIsShow(false)
        break
      case 'knowledge_base':
        setSelectKnowlegdeActionShow(true)
        setIsShow(false)
        console.log('Selected type: knowledge_base')
        break
      case 'mcp':
        console.log('Selected type: mcp')
        break
    }
  }

  // Define all styles as separate objects to improve readability and maintainability
  const containerStyle: CSSProperties = {
    // position: 'absolute',
    // bottom: '10%',
    // left: '23%',
    marginLeft: '2%',
    width: '8%',
    minWidth: '120px',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 4px 12px var(--theme-color-outline, rgba(0, 0, 0, 0.15))'
  }

  const listContainerStyle: CSSProperties = {
    overflow: 'hidden',
    transition: 'height 0.3s ease, opacity 0.3s ease',
    height: 0,
    opacity: isShow ? 1 : 0,
    backgroundColor: 'var(--color-background, var(--theme-color-hover))'
  }

  // Create a function to get the item style based on whether it's selected and its position
  const getItemStyle = (index: number, isSelected: boolean): CSSProperties => {
    return {
      backgroundColor: isSelected
        ? 'var(--theme-color, var(--ant-primary-color))'
        : 'var(--color-background-soft, #ffffff)',
      color: isSelected ? '#fff' : 'var(--color-text, #000)',
      padding: '12px 16px',
      borderBottom: index < data.length - 1 ? '1px solid var(--color-border, var(--theme-color-hover))' : 'none',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      borderRadius: index === 0 ? '8px 8px 0 0' : index === data.length - 1 ? '0 0 8px 8px' : '0'
    }
  }

  return (
    <div style={containerStyle}>
      {/* Show menu list when isShow is true */}
      {isShow && (
        <div ref={listRef} style={listContainerStyle}>
          <List
            bordered={false}
            dataSource={data}
            renderItem={(item, index) => (
              <List.Item
                style={getItemStyle(index, selectedIndex === index)}
                onClick={() => {
                  setSelectedIndex(index)
                  handleItemSelect(item.type)
                }}
                onMouseEnter={() => setSelectedIndex(index)}>
                {item.name}
              </List.Item>
            )}
          />
        </div>
      )}
      {/* Show only @ with SelectAtActionModel when model is selected */}
      {selectModelActionShow && (
        <SelectAtActionModel
          isShow={selectModelActionShow}
          // setIsShow={setSelectModelActionShow}
          onClose={onClose}
          onMentionModel={onMentionModel}
          mentionModels={mentionModels}
        />
      )}
      {selectKnowledgeActionShow && (
        <SelectAtActionKnowledge
          onClose={onClose}
          isShow={selectKnowledgeActionShow}
          // setIsShow={setSelectKnowlegdeActionShow}
          handleKnowledgeBaseSelect={handleKnowledgeBaseSelect}
          selectedKnowledgeBase={selectedKnowledgeBases}
        />
      )}
    </div>
  )
}
