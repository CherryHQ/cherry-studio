import { CheckOutlined, RightOutlined } from '@ant-design/icons'
import { isMac } from '@renderer/config/constant'
import { classNames } from '@renderer/utils'
import { Flex } from 'antd'
import { t } from 'i18next'
import React, { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import { QuickPanelContext } from './provider'
import { QuickPanelCallBackOptions, QuickPanelCloseAction, QuickPanelListItem, QuickPanelOpenOptions } from './types'

interface Props {
  setInputText: React.Dispatch<React.SetStateAction<string>>
}

/**
 * @description 快捷面板内容视图;
 * 请不要往这里添加入参，避免耦合;
 * 这里只读取来自上下文QuickPanelContext的数据
 *
 * 无奈之举，为了清除输入框搜索文本，所以传了个setInputText进来
 */
export const QuickPanelView: React.FC<Props> = ({ setInputText }) => {
  const ctx = use(QuickPanelContext)

  if (!ctx) {
    throw new Error('QuickPanel must be used within a QuickPanelProvider')
  }

  const ASSISTIVE_KEY = isMac ? '⌘' : 'Ctrl'
  const [isAssistiveKeyPressed, setIsAssistiveKeyPressed] = useState(false)

  // 避免上下翻页时，鼠标干扰
  const [isMouseOver, setIsMouseOver] = useState(false)

  const [index, setIndex] = useState(ctx.defaultIndex)
  const [historyPanel, setHistoryPanel] = useState<QuickPanelOpenOptions[]>([])

  const bodyRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)

  const scrollBlock = useRef<ScrollLogicalPosition>('nearest')

  const [searchText, setSearchText] = useState('')
  const searchTextRef = useRef('')

  // 解决长按上下键时滚动太慢问题
  const keyPressCount = useRef<number>(0)
  const scrollBehavior = useRef<'auto' | 'smooth'>('smooth')

  // 处理搜索，过滤列表
  const list = useMemo(() => {
    if (!ctx.isVisible && !ctx.symbol) return []
    const newList = ctx.list?.filter((item) => {
      const _searchText = searchText.replace(/^[/@]/, '')
      if (!_searchText) return true

      let filterText = item.filterText || ''
      if (typeof item.label === 'string') {
        filterText += item.label
      }
      if (typeof item.description === 'string') {
        filterText += item.description
      }

      return filterText.toLowerCase().includes(_searchText.toLowerCase())
    })

    setIndex(newList.length > 0 ? ctx.defaultIndex || 0 : -1)

    return newList
  }, [ctx.defaultIndex, ctx.isVisible, ctx.list, ctx.symbol, searchText])

  const canForwardAndBackward = useMemo(() => {
    return list.some((item) => item.isMenu) || historyPanel.length > 0
  }, [list, historyPanel])

  const clearSearchText = useCallback(
    (includeSymbol = false) => {
      const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement
      const cursorPosition = textArea.selectionStart ?? 0
      const prevChar = textArea.value[cursorPosition - 1]
      if ((prevChar === '/' || prevChar === '@') && !searchTextRef.current) {
        searchTextRef.current = prevChar
      }

      const _searchText = includeSymbol ? searchTextRef.current : searchTextRef.current.replace(/^[/@]/, '')
      if (!_searchText) return

      const inputText = textArea.value
      let newText = inputText
      const searchPattern = new RegExp(`${_searchText}$`)

      const match = inputText.slice(0, cursorPosition).match(searchPattern)
      if (match) {
        const start = match.index || 0
        const end = start + match[0].length
        newText = inputText.slice(0, start) + inputText.slice(end)
        setInputText(newText)

        setTimeout(() => {
          textArea.focus()
          textArea.setSelectionRange(start, start)
        }, 0)
      }
      setSearchText('')
    },
    [setInputText]
  )

  const handleClose = useCallback(
    (action?: QuickPanelCloseAction) => {
      ctx.close(action)
      setHistoryPanel([])

      if (action === 'delete-symbol') {
        const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement
        if (textArea) {
          setInputText(textArea.value)
        }
      } else if (action && !['outsideclick', 'esc'].includes(action)) {
        clearSearchText(true)
      }
    },
    [ctx, clearSearchText, setInputText]
  )

  const handleItemAction = useCallback(
    (item: QuickPanelListItem, action?: QuickPanelCloseAction) => {
      if (item.disabled) return

      const quickPanelCallBackOptions: QuickPanelCallBackOptions = {
        symbol: ctx.symbol,
        action,
        item,
        searchText: searchText,
        multiple: isAssistiveKeyPressed
      }

      ctx.beforeAction?.(quickPanelCallBackOptions)
      item?.action?.(quickPanelCallBackOptions)
      ctx.afterAction?.(quickPanelCallBackOptions)

      if (item.isMenu) {
        // 保存上一个打开的选项，用于回退
        setHistoryPanel((prev) => [
          ...(prev || []),
          {
            title: ctx.title,
            list: ctx.list,
            symbol: ctx.symbol,
            multiple: ctx.multiple,
            defaultIndex: index,
            pageSize: ctx.pageSize,
            onClose: ctx.onClose,
            beforeAction: ctx.beforeAction,
            afterAction: ctx.afterAction
          }
        ])
        clearSearchText(false)
        return
      }

      if (ctx.multiple && isAssistiveKeyPressed) return

      handleClose(action)
    },
    [ctx, searchText, isAssistiveKeyPressed, handleClose, clearSearchText, index]
  )

  useEffect(() => {
    searchTextRef.current = searchText
  }, [searchText])

  // 获取当前输入的搜索词
  useEffect(() => {
    if (!ctx.isVisible) return

    const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement

    const handleInput = (e: Event) => {
      const target = e.target as HTMLTextAreaElement
      const cursorPosition = target.selectionStart
      const textBeforeCursor = target.value.slice(0, cursorPosition)
      const lastSlashIndex = textBeforeCursor.lastIndexOf('/')
      const lastAtIndex = textBeforeCursor.lastIndexOf('@')
      const lastSymbolIndex = Math.max(lastSlashIndex, lastAtIndex)

      if (lastSymbolIndex !== -1) {
        const newSearchText = textBeforeCursor.slice(lastSymbolIndex)
        setSearchText(newSearchText)
      } else {
        handleClose('delete-symbol')
      }
    }

    textArea.addEventListener('input', handleInput)

    return () => {
      textArea.removeEventListener('input', handleInput)
      setSearchText('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.isVisible])

  // 处理上下翻时滚动到选中的元素
  useEffect(() => {
    if (!contentRef.current) return

    const selectedElement = contentRef.current.children[index] as HTMLElement
    if (selectedElement) {
      selectedElement.scrollIntoView({
        block: scrollBlock.current,
        behavior: scrollBehavior.current
      })
      scrollBlock.current = 'nearest'
    }
  }, [index])

  // 处理键盘事件
  useEffect(() => {
    if (!ctx.isVisible) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isMac ? e.metaKey : e.ctrlKey) {
        setIsAssistiveKeyPressed(true)
      }

      // 处理上下翻页时，滚动太慢问题
      if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
        keyPressCount.current++
        if (keyPressCount.current > 5) {
          scrollBehavior.current = 'auto'
        }
      }

      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter', 'Escape'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        setIsMouseOver(false)
      }
      if (['ArrowLeft', 'ArrowRight'].includes(e.key) && isAssistiveKeyPressed) {
        e.preventDefault()
        e.stopPropagation()
        setIsMouseOver(false)
      }

      switch (e.key) {
        case 'ArrowUp':
          if (isAssistiveKeyPressed) {
            scrollBlock.current = 'start'
            setIndex((prev) => {
              const newIndex = prev - ctx.pageSize
              if (prev === 0) return list.length - 1
              return newIndex < 0 ? 0 : newIndex
            })
          } else {
            scrollBlock.current = 'nearest'
            setIndex((prev) => (prev > 0 ? prev - 1 : list.length - 1))
          }
          break

        case 'ArrowDown':
          if (isAssistiveKeyPressed) {
            scrollBlock.current = 'start'
            setIndex((prev) => {
              const newIndex = prev + ctx.pageSize
              if (prev + 1 === list.length) return 0
              return newIndex >= list.length ? list.length - 1 : newIndex
            })
          } else {
            scrollBlock.current = 'nearest'
            setIndex((prev) => (prev < list.length - 1 ? prev + 1 : 0))
          }
          break

        case 'PageUp':
          scrollBlock.current = 'start'
          setIndex((prev) => {
            const newIndex = prev - ctx.pageSize
            return newIndex < 0 ? 0 : newIndex
          })
          break

        case 'PageDown':
          scrollBlock.current = 'start'
          setIndex((prev) => {
            const newIndex = prev + ctx.pageSize
            return newIndex >= list.length ? list.length - 1 : newIndex
          })
          break

        case 'ArrowLeft':
          if (!isAssistiveKeyPressed) return
          if (!historyPanel.length) return
          clearSearchText(false)
          if (historyPanel.length > 0) {
            const lastPanel = historyPanel.pop()
            if (lastPanel) {
              ctx.open(lastPanel)
            }
          }
          break

        case 'ArrowRight':
          if (!isAssistiveKeyPressed) return
          if (!list?.[index]?.isMenu) return
          clearSearchText(false)
          handleItemAction(list[index], 'enter')
          break

        case 'Enter':
          if (list?.[index]) {
            handleItemAction(list[index], 'enter')
          }
          break
        case 'Escape':
          handleClose('esc')
          break
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isMac ? !e.metaKey : !e.ctrlKey) {
        setIsAssistiveKeyPressed(false)
      }

      keyPressCount.current = 0
      scrollBehavior.current = 'smooth'
    }

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('#inputbar')) return
      if (bodyRef.current && !bodyRef.current.contains(target)) {
        handleClose('outsideclick')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('click', handleClickOutside)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('click', handleClickOutside)
    }
  }, [index, isAssistiveKeyPressed, historyPanel, ctx, list, handleItemAction, handleClose, clearSearchText])

  const [footerWidth, setFooterWidth] = useState(0)

  useEffect(() => {
    if (!footerRef.current || !ctx.isVisible) return
    const footerWidth = footerRef.current.clientWidth
    setFooterWidth(footerWidth)

    const handleResize = () => {
      const footerWidth = footerRef.current!.clientWidth
      setFooterWidth(footerWidth)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [ctx.isVisible])

  return (
    <QuickPanelContainer $pageSize={ctx.pageSize} className={ctx.isVisible ? 'visible' : ''}>
      <QuickPanelBody ref={bodyRef} onMouseMove={() => setIsMouseOver(true)}>
        <QuickPanelContent ref={contentRef} $pageSize={ctx.pageSize} $isMouseOver={isMouseOver}>
          {list.map((item, i) => (
            <QuickPanelItem
              className={classNames({
                focused: i === index,
                selected: item.isSelected,
                disabled: item.disabled
              })}
              key={i}
              onClick={(e) => {
                e.stopPropagation()
                handleItemAction(item, 'click')
              }}
              onMouseEnter={() => setIndex(i)}>
              <QuickPanelItemLeft>
                <QuickPanelItemIcon>{item.icon}</QuickPanelItemIcon>
                <QuickPanelItemLabel>{item.label}</QuickPanelItemLabel>
              </QuickPanelItemLeft>

              <QuickPanelItemRight>
                {item.description && <QuickPanelItemDescription>{item.description}</QuickPanelItemDescription>}
                <QuickPanelItemSuffixIcon>
                  {item.suffix ? (
                    item.suffix
                  ) : item.isSelected ? (
                    <CheckOutlined />
                  ) : (
                    item.isMenu && !item.disabled && <RightOutlined />
                  )}
                </QuickPanelItemSuffixIcon>
              </QuickPanelItemRight>
            </QuickPanelItem>
          ))}
        </QuickPanelContent>
        <QuickPanelFooter ref={footerRef}>
          <QuickPanelFooterTitle>{ctx.title || ''}</QuickPanelFooterTitle>
          <QuickPanelFooterTips $footerWidth={footerWidth}>
            <span>ESC {t('settings.quickPanel.close')}</span>

            <Flex align="center" gap={4}>
              ▲▼ {t('settings.quickPanel.select')}
            </Flex>

            {footerWidth >= 500 && (
              <>
                <Flex align="center" gap={4}>
                  <span style={{ color: isAssistiveKeyPressed ? 'var(--color-primary)' : 'var(--color-text-3)' }}>
                    {ASSISTIVE_KEY}
                  </span>
                  + ▲▼ {t('settings.quickPanel.page')}
                </Flex>

                {canForwardAndBackward && (
                  <Flex align="center" gap={4}>
                    <span style={{ color: isAssistiveKeyPressed ? 'var(--color-primary)' : 'var(--color-text-3)' }}>
                      {ASSISTIVE_KEY}
                    </span>
                    + ◀︎▶︎ {t('settings.quickPanel.back')}/{t('settings.quickPanel.forward')}
                  </Flex>
                )}
              </>
            )}

            <Flex align="center" gap={4}>
              ↩︎ {t('settings.quickPanel.confirm')}
            </Flex>

            {ctx.multiple && (
              <Flex align="center" gap={4}>
                <span style={{ color: isAssistiveKeyPressed ? 'var(--color-primary)' : 'var(--color-text-3)' }}>
                  {ASSISTIVE_KEY}
                </span>
                + ↩︎ {t('settings.quickPanel.multiple')}
              </Flex>
            )}
          </QuickPanelFooterTips>
        </QuickPanelFooter>
      </QuickPanelBody>
    </QuickPanelContainer>
  )
}

const QuickPanelContainer = styled.div<{ $pageSize: number }>`
  --focused-color: rgba(0, 0, 0, 0.06);
  --selected-color: rgba(0, 0, 0, 0.03);
  max-height: 0;
  position: absolute;
  top: 1px;
  left: 0;
  right: 0;
  width: 100%;
  padding: 0 30px 0 30px;
  transform: translateY(-100%);
  transform-origin: bottom;
  transition: max-height 0.2s ease;
  overflow: hidden;
  pointer-events: none;
  &.visible {
    pointer-events: auto;
    max-height: ${(props) => props.$pageSize * 31 + 100}px;
  }
  body[theme-mode='dark'] & {
    --focused-color: rgba(255, 255, 255, 0.1);
    --selected-color: rgba(255, 255, 255, 0.03);
  }
`

const QuickPanelBody = styled.div`
  background-color: rgba(240, 240, 240, 0.5);
  backdrop-filter: blur(35px) saturate(150%);
  border-radius: 8px 8px 0 0;
  padding: 5px 0;
  border-width: 0.5px 0.5px 0 0.5px;
  border-style: solid;
  border-color: var(--color-border);
  body[theme-mode='dark'] & {
    background-color: rgba(40, 40, 40, 0.4);
  }
`

const QuickPanelFooter = styled.div`
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 8px 12px 5px;
`

const QuickPanelFooterTips = styled.div<{ $footerWidth: number }>`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
  gap: 16px;
  font-size: 10px;
  color: var(--color-text-3);
`

const QuickPanelFooterTitle = styled.div`
  font-size: 11px;
  color: var(--color-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const QuickPanelContent = styled.div<{ $pageSize: number; $isMouseOver: boolean }>`
  width: 100%;
  max-height: ${(props) => props.$pageSize * 31}px;
  padding: 0 5px;
  overflow-x: hidden;
  overflow-y: auto;
  pointer-events: ${(props) => (props.$isMouseOver ? 'auto' : 'none')};

  &::-webkit-scrollbar {
    width: 3px;
  }
`

const QuickPanelItem = styled.div`
  height: 30px;
  display: flex;
  align-items: center;
  gap: 20px;
  justify-content: space-between;
  padding: 5px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.1s ease;
  margin-bottom: 1px;
  &.selected {
    background-color: var(--selected-color);
  }
  &.focused {
    background-color: var(--focused-color);
  }
  &.disabled {
    --selected-color: rgba(0, 0, 0, 0.02);
    opacity: 0.4;
    cursor: not-allowed;
  }
`

const QuickPanelItemLeft = styled.div`
  max-width: 60%;
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  flex-shrink: 0;
`

const QuickPanelItemIcon = styled.span`
  font-size: 12px;
  color: var(--color-text-3);
`

const QuickPanelItemLabel = styled.span`
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
`

const QuickPanelItemRight = styled.div`
  min-width: 20%;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  color: var(--color-text-3);
`

const QuickPanelItemDescription = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const QuickPanelItemSuffixIcon = styled.span`
  min-width: 12px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
`
