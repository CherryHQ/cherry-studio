import { CloseOutlined, DownOutlined, UpOutlined } from '@ant-design/icons'
import { debounce } from 'lodash'
import React, { useCallback, useImperativeHandle, useState } from 'react'
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
  enable(): void
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

const highlightText = (textNode: Node, searchText: string, highlightClass: string) => {
  const textNodeParentNode: HTMLElement | null = textNode.parentNode as HTMLElement
  if (textNodeParentNode) {
    if (textNodeParentNode.classList.contains(highlightClass)) {
      return null
    }
  }
  const highlightText = searchText.toLowerCase()
  if (textNode.nodeType !== Node.TEXT_NODE) {
    return null
  }
  const textContent = textNode.textContent!.toLowerCase()
  let index = textContent.indexOf(highlightText)
  if (index === -1) {
    return null
  }

  const parentNode = textNode.parentNode
  if (!parentNode) {
    return null
  }

  const fragment = document.createDocumentFragment()
  let currentIndex = 0
  let lastIndex = 0
  const highlightTextSet = new Set<HTMLSpanElement>()
  while (index !== -1) {
    if (index > lastIndex) {
      fragment.appendChild(document.createTextNode(textContent.substring(lastIndex, index)))
    }

    const highlightSpan = document.createElement('span')
    highlightSpan.className = highlightClass
    highlightSpan.textContent = highlightText
    fragment.appendChild(highlightSpan)
    highlightTextSet.add(highlightSpan)
    currentIndex = index + highlightText.length
    lastIndex = currentIndex
    index = textContent.indexOf(highlightText, currentIndex)
  }

  if (lastIndex < textContent.length) {
    fragment.appendChild(document.createTextNode(textContent.substring(lastIndex)))
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

export const ContentSearch = React.forwardRef<ContentSearchRef, Props>(({ children, searchTarget, filter }, ref) => {
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
  const highlightTextSet = useState(new Set<Node>())[0]

  const locateByIndex = (index: number) => {
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
          highlightTextNode.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
          })
        }
      }
    }
  }

  const restoreHighlight = () => {
    const highlightTextParentNodeSet = new Set<HTMLElement>()
    for (const highlightTextNode of highlightTextSet) {
      if (highlightTextNode.textContent) {
        const textNode = document.createTextNode(highlightTextNode.textContent)
        const node = highlightTextNode as HTMLElement
        if (node.parentNode) {
          highlightTextParentNodeSet.add(node.parentNode as HTMLElement)
        }
        node.replaceWith(textNode)
      }
    }
    for (const parentNode of highlightTextParentNodeSet) {
      mergeAdjacentTextNodes(parentNode)
    }
    highlightTextSet.clear()
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
        const list = highlightText(node, searchText, HIGHLIGHT_CLASS)
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
            if (index) {
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
    if (event.target.value.length === 0) {
      implementation.resetSearchState()
    } else {
      searchHandler()
    }
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

  const implementation = {
    disable() {
      setEnableContentSearch(false)
      restoreHighlight()
    },
    enable() {
      setEnableContentSearch(true)
      const targetIndex = search()
      if (targetIndex !== null) {
        locateByIndex(targetIndex)
      }
      searchInputFocus()
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
      }
    },
    search() {
      if (enableContentSearch) {
        const targetIndex = search()
        if (targetIndex !== null) {
          locateByIndex(targetIndex)
        }
      }
    },
    silentSearch() {
      if (enableContentSearch) {
        const targetIndex = search()
        if (targetIndex !== null) {
          setSearchResultIndex(targetIndex)
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
    enable() {
      implementation.enable()
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

  return (
    <Container ref={containerRef} style={enableContentSearch ? { display: 'flex' } : {}}>
      <Input
        ref={searchInputRef}
        onInput={userInputHandler}
        onKeyDown={keyDownHandler}
        style={searchCompleted ? { paddingRight: 'initial' } : { paddingRight: '4em' }}></Input>
      <Separator></Separator>
      <SearchResults style={searchCompleted ? {} : { minWidth: 'auto' }}>
        {searchCompleted !== SearchCompletedState.NotSearched && (
          <>
            <SearchResultCount>{totalCount !== 0 ? searchResultIndex + 1 : 0}</SearchResultCount>
            <SearchResultSeparator>/</SearchResultSeparator>
            <SearchResultTotalCount>{totalCount}</SearchResultTotalCount>
          </>
        )}
      </SearchResults>
      {children}
      <PrevButton onClick={prevButtonOnClick}></PrevButton>
      <NextButton onClick={nextButtonOnClick}></NextButton>
      <CloseButton onClick={closeButtonOnClick}></CloseButton>
    </Container>
  )
})
ContentSearch.displayName = 'ContentSearch'

const Container = styled.div`
  position: absolute;
  right: 16px;
  top: 16px;
  display: none;
  width: min(380px, 35vw);
  background-color: var(--color-background);
  border: var(--color-border) 1px solid;
  padding: 6px;
  border-radius: 8px;
  user-select: none;

  box-shadow:
    1px 1px 4px 1px rgba(0, 0, 0, 0.04),
    2px 2px 8px 1px rgba(0, 0, 0, 0.04),
    4px 4px 16px 4px rgba(0, 0, 0, 0.02);
`

const Input = styled.input`
  border: none;
  color: var(--color-text);
  background-color: transparent;
  outline: none;
  width: 100%;
  padding-left: 10px;
  flex: 1 1 auto;
`

const Separator = styled.div`
  width: 1px;
  background-color: var(--color-border);
  margin-left: 12px;
  margin-right: 4px;
  flex: 1 0 auto;
`

const SearchResults = styled.div`
  display: flex;
  justify-content: center;
  min-width: 4em;
  flex: 1 0 auto;
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

const PrevButton = styled(UpOutlined)`
  border: none;
  outline: none;
  padding: 6px;
  border-radius: 8px;
  cursor: pointer;
  flex: 1 0 auto;

  &:hover {
    background-color: var(--color-hover);
  }
`

const NextButton = styled(DownOutlined)`
  border: none;
  outline: none;
  padding: 6px;
  border-radius: 8px;
  cursor: pointer;
  flex: 1 0 auto;

  &:hover {
    background-color: var(--color-hover);
  }
`

const CloseButton = styled(CloseOutlined)`
  border: none;
  outline: none;
  padding: 6px;
  border-radius: 8px;
  cursor: pointer;
  flex: 1 0 auto;

  &:hover {
    background-color: var(--color-hover);
  }
`
