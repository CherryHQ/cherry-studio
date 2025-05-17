import { Tooltip } from 'antd'
import { debounce } from 'lodash'
import { CaseSensitive, ChevronDown, ChevronUp, User, WholeWord, X } from 'lucide-react'
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const HIGHLIGHT_CLASS = 'highlight'
const HIGHLIGHT_SELECT_CLASS = 'selected'

interface Props {
  children?: React.ReactNode
  searchTarget: React.RefObject<React.ReactNode> | React.RefObject<HTMLElement> | HTMLElement
  /**
   * 过滤`node`，`node`只会是`Node.TEXT_NODE`类型的文本节点
   *
   * 返回`true`表示该`node`会被搜索
   */
  filter: (node: Node) => boolean
  includeUser?: boolean
  onIncludeUserChange?: (value: boolean) => void
}

enum SearchCompletedState {
  NotSearched,
  FirstSearched
}

enum SearchTargetIndex {
  Next,
  Prev
}

export interface ContentSearchRef {
  disable(): void
  enable(initialText?: string): void
  // 搜索下一个并定位
  searchNext(): void
  // 搜索上一个并定位
  searchPrev(): void
  // 搜索并定位
  search(): void
  // 搜索但不定位，或者说是更新
  silentSearch(): void
  focus(): void
}

interface MatchInfo {
  index: number
  length: number
  text: string
}

const escapeRegExp = (string: string): string => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
}

const findWindowVerticalCenterElementIndex = (elementList: HTMLElement[]): number | null => {
  if (!elementList || elementList.length === 0) {
    return null
  }
  let closestElementIndex: number | null = null
  let minVerticalDistance = Infinity
  const windowCenterY = window.innerHeight / 2
  for (let i = 0; i < elementList.length; i++) {
    const element = elementList[i]
    if (!(element instanceof HTMLElement)) {
      continue
    }
    const rect = element.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      continue
    }
    const elementCenterY = rect.top + rect.height / 2
    const verticalDistance = Math.abs(elementCenterY - windowCenterY)
    if (verticalDistance < minVerticalDistance) {
      minVerticalDistance = verticalDistance
      closestElementIndex = i
    }
  }
  return closestElementIndex
}

const highlightText = (
  textNode: Node,
  searchText: string,
  highlightClass: string,
  isCaseSensitive: boolean,
  isWholeWord: boolean
): HTMLSpanElement[] | null => {
  const textNodeParentNode: HTMLElement | null = textNode.parentNode as HTMLElement
  if (textNodeParentNode) {
    if (textNodeParentNode.classList.contains(highlightClass)) {
      return null
    }
  }
  if (textNode.nodeType !== Node.TEXT_NODE || !textNode.textContent) {
    return null
  }

  const textContent = textNode.textContent
  const escapedSearchText = escapeRegExp(searchText)

  // 检查搜索文本是否仅包含拉丁字母
  const hasOnlyLatinLetters = /^[a-zA-Z\s]+$/.test(searchText)

  // 只有当搜索文本仅包含拉丁字母时才应用大小写敏感
  const regexFlags = hasOnlyLatinLetters && isCaseSensitive ? 'g' : 'gi'
  const regexPattern = isWholeWord ? `\\b${escapedSearchText}\\b` : escapedSearchText
  const regex = new RegExp(regexPattern, regexFlags)

  let match
  const matches: MatchInfo[] = []
  while ((match = regex.exec(textContent)) !== null) {
    if (typeof match.index === 'number' && typeof match[0] === 'string') {
      matches.push({ index: match.index, length: match[0].length, text: match[0] })
    } else {
      console.error('Unexpected match format:', match)
    }
  }

  if (matches.length === 0) {
    return null
  }

  const parentNode = textNode.parentNode
  if (!parentNode) {
    return null
  }

  const fragment = document.createDocumentFragment()
  let currentIndex = 0
  const highlightTextSet = new Set<HTMLSpanElement>()

  matches.forEach(({ index, length, text }) => {
    if (index > currentIndex) {
      fragment.appendChild(document.createTextNode(textContent.substring(currentIndex, index)))
    }
    const highlightSpan = document.createElement('span')
    highlightSpan.className = highlightClass
    highlightSpan.textContent = text // Use the matched text to preserve case if not case-sensitive
    fragment.appendChild(highlightSpan)
    highlightTextSet.add(highlightSpan)
    currentIndex = index + length
  })

  if (currentIndex < textContent.length) {
    fragment.appendChild(document.createTextNode(textContent.substring(currentIndex)))
  }

  parentNode.replaceChild(fragment, textNode)
  return [...highlightTextSet]
}

const mergeAdjacentTextNodes = (node: HTMLElement) => {
  const children = Array.from(node.childNodes)
  const groups: Array<Node | { text: string; nodes: Node[] }> = []
  let currentTextGroup: { text: string; nodes: Node[] } | null = null

  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (currentTextGroup === null) {
        currentTextGroup = {
          text: child.textContent ?? '',
          nodes: [child]
        }
      } else {
        currentTextGroup.text += child.textContent
        currentTextGroup.nodes.push(child)
      }
    } else {
      if (currentTextGroup !== null) {
        groups.push(currentTextGroup!)
        currentTextGroup = null
      }
      groups.push(child)
    }
  }

  if (currentTextGroup !== null) {
    groups.push(currentTextGroup)
  }

  const newChildren = groups.map((group) => {
    if (group instanceof Node) {
      return group
    } else {
      return document.createTextNode(group.text)
    }
  })

  node.replaceChildren(...newChildren)
}

// eslint-disable-next-line @eslint-react/no-forward-ref
export const ContentSearch = React.forwardRef<ContentSearchRef, Props>(
  ({ searchTarget, filter, includeUser = false, onIncludeUserChange }, ref) => {
    const target: HTMLElement | null = (() => {
      if (searchTarget instanceof HTMLElement) {
        return searchTarget
      } else {
        return (searchTarget.current as HTMLElement) ?? null
      }
    })()
    const containerRef = React.useRef<HTMLDivElement>(null)
    const searchInputRef = React.useRef<HTMLInputElement>(null)
    const [searchResultIndex, setSearchResultIndex] = useState(0)
    const [totalCount, setTotalCount] = useState(0)
    const [enableContentSearch, setEnableContentSearch] = useState(false)
    const [searchCompleted, setSearchCompleted] = useState(SearchCompletedState.NotSearched)
    const [isCaseSensitive, setIsCaseSensitive] = useState(false)
    const [isWholeWord, setIsWholeWord] = useState(false)
    const [shouldScroll, setShouldScroll] = useState(false)
    const highlightTextSet = useState(new Set<Node>())[0]
    const prevSearchText = useRef('')
    const { t } = useTranslation()

    const locateByIndex = (index: number, shouldScroll = true) => {
      if (target) {
        const highlightTextNodes = [...highlightTextSet] as HTMLElement[]
        highlightTextNodes.sort((a, b) => {
          const { top: aTop } = a.getBoundingClientRect()
          const { top: bTop } = b.getBoundingClientRect()
          return aTop - bTop
        })
        for (const node of highlightTextNodes) {
          node.classList.remove(HIGHLIGHT_SELECT_CLASS)
        }
        setSearchResultIndex(index)
        if (highlightTextNodes.length > 0) {
          const highlightTextNode = highlightTextNodes[index] ?? null
          if (highlightTextNode) {
            highlightTextNode.classList.add(HIGHLIGHT_SELECT_CLASS)
            if (shouldScroll) {
              highlightTextNode.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'center'
              })
            }
          }
        }
      }
    }

    const restoreHighlight = () => {
      const highlightTextParentNodeSet = new Set<HTMLElement>()
      // Make a copy because the set might be modified during iteration indirectly
      const nodesToRestore = [...highlightTextSet]
      for (const highlightTextNode of nodesToRestore) {
        if (highlightTextNode.textContent) {
          const textNode = document.createTextNode(highlightTextNode.textContent)
          const node = highlightTextNode as HTMLElement
          if (node.parentNode) {
            highlightTextParentNodeSet.add(node.parentNode as HTMLElement)
            node.replaceWith(textNode) // This removes the node from the DOM
          }
        }
      }
      highlightTextSet.clear() // Clear the original set after processing
      for (const parentNode of highlightTextParentNodeSet) {
        mergeAdjacentTextNodes(parentNode)
      }
      // highlightTextSet.clear() // Already cleared
    }

    const search = (searchTargetIndex?: SearchTargetIndex): number | null => {
      const searchText = searchInputRef.current?.value.trim() ?? null
      if (target && searchText !== null && searchText !== '') {
        restoreHighlight()
        const iter = document.createNodeIterator(target, NodeFilter.SHOW_TEXT)
        let textNode: Node | null
        const textNodeSet: Set<Node> = new Set()
        while ((textNode = iter.nextNode())) {
          if (filter(textNode)) {
            textNodeSet.add(textNode)
          }
        }

        const highlightTextSetTemp = new Set<HTMLSpanElement>()
        for (const node of textNodeSet) {
          const list = highlightText(node, searchText, HIGHLIGHT_CLASS, isCaseSensitive, isWholeWord)
          if (list) {
            list.forEach((node) => highlightTextSetTemp.add(node))
          }
        }
        const highlightTextList = [...highlightTextSetTemp]
        setTotalCount(highlightTextList.length)
        highlightTextSetTemp.forEach((node) => highlightTextSet.add(node))
        const changeIndex = () => {
          let index: number
          switch (searchTargetIndex) {
            case SearchTargetIndex.Next:
              {
                index = (searchResultIndex + 1) % highlightTextList.length
              }
              break
            case SearchTargetIndex.Prev:
              {
                index = (searchResultIndex - 1 + highlightTextList.length) % highlightTextList.length
              }
              break
            default: {
              index = searchResultIndex
            }
          }
          return Math.max(index, 0)
        }

        const targetIndex = (() => {
          switch (searchCompleted) {
            case SearchCompletedState.NotSearched: {
              setSearchCompleted(SearchCompletedState.FirstSearched)
              const index = findWindowVerticalCenterElementIndex(highlightTextList)
              if (index !== null) {
                setSearchResultIndex(index)
                return index
              } else {
                setSearchResultIndex(0)
                return 0
              }
            }
            case SearchCompletedState.FirstSearched: {
              return changeIndex()
            }
            default: {
              return null
            }
          }
        })()

        if (targetIndex === null) {
          return null
        } else {
          const totalCount = highlightTextSet.size
          if (targetIndex >= totalCount) {
            return totalCount - 1
          } else {
            return targetIndex
          }
        }
      } else {
        return null
      }
    }

    const _searchHandlerDebounce = debounce(() => {
      implementation.search()
    }, 300)
    const searchHandler = useCallback(_searchHandlerDebounce, [_searchHandlerDebounce])
    const userInputHandler = (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value.trim()
      if (value.length === 0) {
        restoreHighlight()
        setTotalCount(0)
        setSearchResultIndex(0)
        setSearchCompleted(SearchCompletedState.NotSearched)
      } else {
        // 用户输入时允许滚动
        setShouldScroll(true)
        searchHandler()
      }
      prevSearchText.current = value
    }

    const keyDownHandler = (event: React.KeyboardEvent<HTMLInputElement>) => {
      const { code, key, shiftKey } = event
      if (key === 'Process') {
        return
      }

      switch (code) {
        case 'Enter':
          {
            if (shiftKey) {
              implementation.searchPrev()
            } else {
              implementation.searchNext()
            }
            event.preventDefault()
          }
          break
        case 'Escape':
          {
            implementation.disable()
          }
          break
      }
    }

    const searchInputFocus = () => requestAnimationFrame(() => searchInputRef.current?.focus())

    const userOutlinedButtonOnClick = () => {
      if (onIncludeUserChange) {
        onIncludeUserChange(!includeUser)
      }
      searchInputFocus()
    }

    const implementation = {
      disable() {
        setEnableContentSearch(false)
        restoreHighlight()
        setShouldScroll(false)
      },
      enable(initialText?: string) {
        setEnableContentSearch(true)
        setShouldScroll(false) // Default to false, search itself might set it to true
        if (searchInputRef.current) {
          const inputEl = searchInputRef.current
          if (initialText && initialText.trim().length > 0) {
            inputEl.value = initialText
            // Trigger search after setting initial text
            // Need to make sure search() uses the new value
            // and also to focus and select
            requestAnimationFrame(() => {
              inputEl.focus()
              inputEl.select()
              setShouldScroll(true)
              const targetIndex = search()
              if (targetIndex !== null) {
                locateByIndex(targetIndex, true) // Ensure scrolling
              } else {
                // If search returns null (e.g., empty input or no matches with initial text), clear state
                restoreHighlight()
                setTotalCount(0)
                setSearchResultIndex(0)
                setSearchCompleted(SearchCompletedState.NotSearched)
              }
            })
          } else {
            requestAnimationFrame(() => {
              inputEl.focus()
              inputEl.select()
            })
            // Only search if there's existing text and no new initialText
            if (inputEl.value.trim()) {
              const targetIndex = search()
              if (targetIndex !== null) {
                setSearchResultIndex(targetIndex)
                // locateByIndex(targetIndex, false); // Don't scroll if just enabling with existing text
              }
            }
          }
        }
      },
      searchNext() {
        if (enableContentSearch) {
          const targetIndex = search(SearchTargetIndex.Next)
          if (targetIndex !== null) {
            locateByIndex(targetIndex)
          }
        }
      },
      searchPrev() {
        if (enableContentSearch) {
          const targetIndex = search(SearchTargetIndex.Prev)
          if (targetIndex !== null) {
            locateByIndex(targetIndex)
          }
        }
      },
      resetSearchState() {
        if (enableContentSearch) {
          setSearchCompleted(SearchCompletedState.NotSearched)
          // Maybe also reset index? Depends on desired behavior
          // setSearchResultIndex(0);
        }
      },
      search() {
        if (enableContentSearch) {
          const targetIndex = search()
          if (targetIndex !== null) {
            locateByIndex(targetIndex, shouldScroll)
          } else {
            // If search returns null (e.g., empty input), clear state
            restoreHighlight()
            setTotalCount(0)
            setSearchResultIndex(0)
            setSearchCompleted(SearchCompletedState.NotSearched)
          }
        }
      },
      silentSearch() {
        if (enableContentSearch) {
          const targetIndex = search()
          if (targetIndex !== null) {
            // 只更新索引，不触发滚动
            locateByIndex(targetIndex, false)
          }
        }
      },
      focus() {
        searchInputFocus()
      }
    }

    useImperativeHandle(ref, () => ({
      disable() {
        implementation.disable()
      },
      enable(initialText?: string) {
        implementation.enable(initialText)
      },
      searchNext() {
        implementation.searchNext()
      },
      searchPrev() {
        implementation.searchPrev()
      },
      search() {
        implementation.search()
      },
      silentSearch() {
        implementation.silentSearch()
      },
      focus() {
        implementation.focus()
      }
    }))

    // Re-run search when options change and search is active
    useEffect(() => {
      if (enableContentSearch && searchInputRef.current?.value.trim()) {
        implementation.search()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isCaseSensitive, isWholeWord, enableContentSearch]) // Add enableContentSearch dependency

    const prevButtonOnClick = () => {
      implementation.searchPrev()
      searchInputFocus()
    }

    const nextButtonOnClick = () => {
      implementation.searchNext()
      searchInputFocus()
    }

    const closeButtonOnClick = () => {
      implementation.disable()
    }

    const caseSensitiveButtonOnClick = () => {
      setIsCaseSensitive(!isCaseSensitive)
      searchInputFocus()
    }

    const wholeWordButtonOnClick = () => {
      setIsWholeWord(!isWholeWord)
      searchInputFocus()
    }

    return (
      <Container ref={containerRef} style={enableContentSearch ? {} : { display: 'none' }}>
        <InputWrapper>
          <Input ref={searchInputRef} onInput={userInputHandler} onKeyDown={keyDownHandler} />
          <Tooltip title={t('button.includes_user_questions')} mouseEnterDelay={0.8} placement="bottom">
            <UserOutlinedButton onClick={userOutlinedButtonOnClick} $active={includeUser} />
          </Tooltip>
          <Tooltip title={t('button.case_sensitive')} mouseEnterDelay={0.8} placement="bottom">
            <CaseSensitiveButton onClick={caseSensitiveButtonOnClick} $active={isCaseSensitive} />
          </Tooltip>
          <Tooltip title={t('button.whole_word')} mouseEnterDelay={0.8} placement="bottom">
            <WholeWordButton onClick={wholeWordButtonOnClick} $active={isWholeWord} />
          </Tooltip>
        </InputWrapper>
        <Separator></Separator>
        <SearchResults>
          {searchCompleted !== SearchCompletedState.NotSearched ? (
            totalCount > 0 ? (
              <>
                <SearchResultCount>{searchResultIndex + 1}</SearchResultCount>
                <SearchResultSeparator>/</SearchResultSeparator>
                <SearchResultTotalCount>{totalCount}</SearchResultTotalCount>
              </>
            ) : (
              <NoResults>{t('common.no_results')}</NoResults>
            )
          ) : (
            <SearchResultsPlaceholder>0/0</SearchResultsPlaceholder>
          )}
        </SearchResults>
        <PrevButton onClick={prevButtonOnClick} disabled={totalCount === 0} />
        <NextButton onClick={nextButtonOnClick} disabled={totalCount === 0} />
        <CloseButton onClick={closeButtonOnClick} />
      </Container>
    )
  }
)

ContentSearch.displayName = 'ContentSearch'

const Container = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 40px;
  background-color: var(--color-background-mute);
  border: var(--color-border) 1px solid;
  padding: 4px;
  border-radius: 8px;
  user-select: none;
  gap: 4px;
  z-index: 10;
`

const InputWrapper = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 auto; /* Take up input's previous space */
`

const Input = styled.input`
  border: none;
  color: var(--color-text);
  background-color: transparent;
  outline: none;
  width: 100%;
  padding: 0 5px; /* Adjust padding, wrapper will handle spacing */
  flex: 1; /* Allow input to grow */
  font-size: 14px;
  font-family: Ubuntu;
`

const Separator = styled.div`
  width: 1px;
  height: 1.5em;
  background-color: var(--color-border);
  margin-left: 2px;
  margin-right: 2px;
  flex: 0 0 auto;
`

const SearchResults = styled.div`
  display: flex;
  justify-content: center;
  width: 80px;
  margin: 0 2px;
  flex: 0 0 auto;
  color: var(--color-text-secondary);
  font-size: 14px;
  font-family: Ubuntu;
`

const SearchResultsPlaceholder = styled.span`
  color: var(--color-text-secondary);
  opacity: 0.5;
  // 改进2: 预留占位符
`

const NoResults = styled.span`
  color: var(--color-text-secondary);
  // 改进: NaN/1 显示为"无结果"
`

const SearchResultCount = styled.span`
  color: var(--color-text);
`

const SearchResultSeparator = styled.span`
  color: var(--color-text);
  margin: 0 4px;
`

const SearchResultTotalCount = styled.span`
  color: var(--color-text);
`

const PrevButton = styled(ChevronUp)<{ disabled: boolean }>`
  border-radius: 4px;
  cursor: ${(props) => (props.disabled ? 'default' : 'pointer')}; // 改进5: 匹配不到时按钮灰掉
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  opacity: ${(props) => (props.disabled ? 0.5 : 1)}; // 改进5: 匹配不到时按钮灰掉

  &:hover {
    background-color: ${(props) => (props.disabled ? 'transparent' : 'var(--color-hover)')};
    color: ${(props) => (props.disabled ? 'inherit' : 'var(--color-text)')};
  }
`

const NextButton = styled(ChevronDown)<{ disabled: boolean }>`
  border-radius: 4px;
  cursor: ${(props) => (props.disabled ? 'default' : 'pointer')};
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  opacity: ${(props) => (props.disabled ? 0.5 : 1)};

  &:hover {
    background-color: ${(props) => (props.disabled ? 'transparent' : 'var(--color-hover)')};
    color: ${(props) => (props.disabled ? 'inherit' : 'var(--color-text)')};
  }
`

const CloseButton = styled(X)`
  border-radius: 4px;
  cursor: pointer;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;

  &:hover {
    background-color: var(--color-hover);
    color: var(--color-icon);
  }
`

const CaseSensitiveButton = styled(CaseSensitive)<{ $active: boolean }>`
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0 1px;
  margin-inline-end: 1px;
  color: ${(props) => (props.$active ? 'var(--color-primary)' : 'var(--color-icon)')};

  &:hover {
    background-color: var(--color-hover);
  }
`
const WholeWordButton = styled(WholeWord)<{ $active: boolean }>`
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0 1px;
  margin-inline-end: 1px;
  color: ${(props) => (props.$active ? 'var(--color-primary)' : 'var(--color-icon)')};

  &:hover {
    background-color: var(--color-hover);
  }
`

const UserOutlinedButton = styled(User)<{ $active: boolean }>`
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0 1px;
  margin-inline-end: 1px;
  color: ${(props) => (props.$active ? 'var(--color-primary)' : 'var(--color-icon)')};

  &:hover {
    background-color: var(--color-hover);
  }
`
