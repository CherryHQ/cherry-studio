import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { ActionIconButton } from '@renderer/components/Buttons'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import { classNames, scrollElementIntoView } from '@renderer/utils'
import { debounce } from 'lodash'
import { CaseSensitive, ChevronDown, ChevronUp, User, WholeWord, X } from 'lucide-react'
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  children?: React.ReactNode
  searchTarget: React.RefObject<React.ReactNode> | React.RefObject<HTMLElement> | HTMLElement
  /**
   * Filter `node`; it is always a `Node.TEXT_NODE` text node.
   *
   * Return `true` to include the node in search.
   */
  filter: NodeFilter
  includeUser?: boolean
  onIncludeUserChange?: (value: boolean) => void
  /**
   * Whether to show the "include user question" toggle (default: true).
   * Rich text editor surfaces usually do not need this button.
   */
  showUserToggle?: boolean
  /**
   * Search bar positioning mode.
   */
  positionMode?: 'fixed' | 'absolute' | 'sticky'
}

enum SearchCompletedState {
  NotSearched,
  Searched
}

export interface ContentSearchRef {
  disable(): void
  enable(initialText?: string): void
  // Search next and scroll into view.
  searchNext(): void
  // Search previous and scroll into view.
  searchPrev(): void
  // Search and scroll into view.
  search(): void
  // Search without scrolling, used for updates.
  silentSearch(): void
  focus(): void
}

const escapeRegExp = (string: string): string => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
}

const findRangesInTarget = (
  target: HTMLElement,
  filter: NodeFilter,
  searchText: string,
  isCaseSensitive: boolean,
  isWholeWord: boolean
): Range[] => {
  CSS.highlights.clear()
  const ranges: Range[] = []

  const escapedSearchText = escapeRegExp(searchText)

  // Check whether the search text contains only Latin letters.
  const hasOnlyLatinLetters = /^[a-zA-Z\s]+$/.test(searchText)

  // Apply case sensitivity only when the search text contains only Latin letters.
  const regexFlags = hasOnlyLatinLetters && isCaseSensitive ? 'g' : 'gi'
  const regexPattern = isWholeWord ? `\\b${escapedSearchText}\\b` : escapedSearchText
  const searchRegex = new RegExp(regexPattern, regexFlags)
  const treeWalker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, filter)
  const allTextNodes: { node: Node; startOffset: number }[] = []
  let fullText = ''

  // 1. Concatenate all text node content.
  while (treeWalker.nextNode()) {
    allTextNodes.push({
      node: treeWalker.currentNode,
      startOffset: fullText.length
    })
    fullText += treeWalker.currentNode.nodeValue
  }

  // 2. Find matches in the full text.
  let match: RegExpExecArray | null = null
  while ((match = searchRegex.exec(fullText))) {
    const matchStart = match.index
    const matchEnd = matchStart + match[0].length

    // 3. Map match indexes back to DOM ranges.
    let startNode: Node | null = null
    let endNode: Node | null = null
    let startOffset = 0
    let endOffset = 0

    // Find the start node and offset.
    for (const nodeInfo of allTextNodes) {
      if (
        matchStart >= nodeInfo.startOffset &&
        matchStart < nodeInfo.startOffset + (nodeInfo.node.nodeValue?.length ?? 0)
      ) {
        startNode = nodeInfo.node
        startOffset = matchStart - nodeInfo.startOffset
        break
      }
    }

    // Find the end node and offset.
    for (const nodeInfo of allTextNodes) {
      if (
        matchEnd > nodeInfo.startOffset &&
        matchEnd <= nodeInfo.startOffset + (nodeInfo.node.nodeValue?.length ?? 0)
      ) {
        endNode = nodeInfo.node
        endOffset = matchEnd - nodeInfo.startOffset
        break
      }
    }

    // Create a range when both start and end nodes are found.
    if (startNode && endNode) {
      const range = new Range()
      range.setStart(startNode, startOffset)
      range.setEnd(endNode, endOffset)
      ranges.push(range)
    }
  }

  return ranges
}

export function ContentSearch({
  searchTarget,
  filter,
  includeUser = false,
  onIncludeUserChange,
  showUserToggle = true,
  positionMode = 'fixed',
  ref
}: Props & { ref?: React.Ref<ContentSearchRef> }) {
  const target: HTMLElement | null = (() => {
    if (searchTarget instanceof HTMLElement) {
      return searchTarget
    } else {
      return (searchTarget.current as HTMLElement) ?? null
    }
  })()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const [enableContentSearch, setEnableContentSearch] = useState(false)
  const [searchCompleted, setSearchCompleted] = useState(SearchCompletedState.NotSearched)
  const [isCaseSensitive, setIsCaseSensitive] = useState(false)
  const [isWholeWord, setIsWholeWord] = useState(false)
  const [allRanges, setAllRanges] = useState<Range[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [narrowMode] = usePreference('chat.narrow_mode')
  const prevSearchText = useRef('')
  const { t } = useTranslation()

  const resetSearch = useCallback(() => {
    CSS.highlights.clear()
    setAllRanges([])
    setSearchCompleted(SearchCompletedState.NotSearched)
  }, [])

  const locateByIndex = useCallback(
    (shouldScroll = true) => {
      // Clear previous highlights.
      CSS.highlights.clear()

      if (allRanges.length > 0) {
        // 1. Create and register highlights for all matches.
        const allMatchesHighlight = new Highlight(...allRanges)
        CSS.highlights.set('search-matches', allMatchesHighlight)

        // 2. Create and register a special highlight for the current match.
        if (currentIndex !== -1 && allRanges[currentIndex]) {
          const currentMatchRange = allRanges[currentIndex]
          const currentMatchHighlight = new Highlight(currentMatchRange)
          CSS.highlights.set('current-match', currentMatchHighlight)

          // 3. Scroll the current match into view.
          // Use the first text node's parent element for scrolling.
          const parentElement = currentMatchRange.startContainer.parentElement
          if (shouldScroll && parentElement) {
            // Prefer the provided scroll container to avoid page-level jumps.
            scrollElementIntoView(parentElement, target)
          }
        }
      }
    },
    [allRanges, currentIndex, target]
  )

  const search = useCallback(
    (jump = false) => {
      const searchText = searchInputRef.current?.value.trim() ?? null
      setSearchCompleted(SearchCompletedState.Searched)
      if (target && searchText !== null && searchText !== '') {
        const ranges = findRangesInTarget(target, filter, searchText, isCaseSensitive, isWholeWord)
        setAllRanges(ranges)
        setCurrentIndex(jump && ranges.length > 0 ? 0 : -1)
      }
    },
    [target, filter, isCaseSensitive, isWholeWord]
  )

  const implementation = useMemo(
    () => ({
      disable: () => {
        setEnableContentSearch(false)
        CSS.highlights.clear()
      },
      enable: (initialText?: string) => {
        setEnableContentSearch(true)
        if (searchInputRef.current) {
          const inputEl = searchInputRef.current
          if (initialText && initialText.trim().length > 0) {
            inputEl.value = initialText
            requestAnimationFrame(() => {
              inputEl.focus()
              inputEl.select()
              search(false)
            })
          } else {
            requestAnimationFrame(() => {
              inputEl.focus()
              inputEl.select()
            })
          }
        }
      },
      searchNext: () => {
        if (allRanges.length > 0) {
          setCurrentIndex((prev) => (prev < allRanges.length - 1 ? prev + 1 : 0))
        }
      },
      searchPrev: () => {
        if (allRanges.length > 0) {
          setCurrentIndex((prev) => (prev > 0 ? prev - 1 : allRanges.length - 1))
        }
      },
      resetSearchState: () => {
        setSearchCompleted(SearchCompletedState.NotSearched)
      },
      search: () => {
        search(true)
        locateByIndex(true)
      },
      silentSearch: () => {
        search(false)
        locateByIndex(false)
      },
      focus: () => {
        searchInputRef.current?.focus()
      }
    }),
    [allRanges.length, locateByIndex, search]
  )

  const _searchHandlerDebounce = useMemo(() => debounce(implementation.search, 300), [implementation.search])

  const searchHandler = useCallback(() => {
    _searchHandlerDebounce()
  }, [_searchHandlerDebounce])

  const userInputHandler = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value.trim()
      if (value.length === 0) {
        resetSearch()
      } else {
        searchHandler()
      }
      prevSearchText.current = value
    },
    [searchHandler, resetSearch]
  )

  const keyDownHandler = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        const value = (event.target as HTMLInputElement).value.trim()
        if (value.length === 0) {
          resetSearch()
          return
        }
        if (event.shiftKey) {
          implementation.searchPrev()
        } else {
          implementation.searchNext()
        }
      } else if (event.key === 'Escape') {
        event.stopPropagation()
        implementation.disable()
      }
    },
    [implementation, resetSearch]
  )

  const searchInputFocus = useCallback(() => {
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [])

  const userOutlinedButtonOnClick = useCallback(() => {
    onIncludeUserChange?.(!includeUser)
    searchInputFocus()
  }, [includeUser, onIncludeUserChange, searchInputFocus])

  useImperativeHandle(ref, () => implementation, [implementation])

  useEffect(() => {
    locateByIndex()
  }, [currentIndex, locateByIndex])

  useEffect(() => {
    if (enableContentSearch && searchInputRef.current?.value.trim()) {
      search(true)
    }
  }, [isCaseSensitive, isWholeWord, enableContentSearch, search])

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
    <Container
      ref={containerRef}
      style={enableContentSearch ? {} : { display: 'none' }}
      overlayPosition={positionMode === 'absolute' ? 'absolute' : 'static'}>
      <NarrowLayout narrowMode={narrowMode} style={{ width: '100%' }}>
        <SearchBarContainer position={positionMode}>
          <InputWrapper>
            <Input
              ref={searchInputRef}
              onInput={userInputHandler}
              onKeyDown={keyDownHandler}
              placeholder={t('chat.assistant.search.placeholder')}
              style={{ lineHeight: '20px' }}
            />
            <ToolBar>
              {showUserToggle && (
                <Tooltip placement="bottom" content={t('button.includes_user_questions')} delay={800}>
                  <ActionIconButton
                    onClick={userOutlinedButtonOnClick}
                    icon={
                      <User size={18} style={{ color: includeUser ? 'var(--color-primary)' : 'var(--color-icon)' }} />
                    }
                  />{' '}
                </Tooltip>
              )}
              <Tooltip placement="bottom" content={t('button.case_sensitive')} delay={800}>
                <ActionIconButton
                  onClick={caseSensitiveButtonOnClick}
                  icon={
                    <CaseSensitive
                      size={18}
                      style={{ color: isCaseSensitive ? 'var(--color-primary)' : 'var(--color-icon)' }}
                    />
                  }
                />{' '}
              </Tooltip>
              <Tooltip placement="bottom" content={t('button.whole_word')} delay={800}>
                <ActionIconButton
                  onClick={wholeWordButtonOnClick}
                  icon={
                    <WholeWord
                      size={18}
                      style={{ color: isWholeWord ? 'var(--color-primary)' : 'var(--color-icon)' }}
                    />
                  }
                />
              </Tooltip>
            </ToolBar>
          </InputWrapper>
          <Separator></Separator>
          <SearchResults>
            {searchCompleted !== SearchCompletedState.NotSearched && allRanges.length > 0 ? (
              <>
                <SearchResultCount>{currentIndex + 1}</SearchResultCount>
                <SearchResultSeparator>/</SearchResultSeparator>
                <SearchResultTotalCount>{allRanges.length}</SearchResultTotalCount>
              </>
            ) : (
              <SearchResultsPlaceholder>0/0</SearchResultsPlaceholder>
            )}
          </SearchResults>
          <ToolBar>
            <ActionIconButton
              onClick={prevButtonOnClick}
              disabled={allRanges.length === 0}
              icon={<ChevronUp size={18} />}
            />
            <ActionIconButton
              onClick={nextButtonOnClick}
              disabled={allRanges.length === 0}
              icon={<ChevronDown size={18} />}
            />
            <ActionIconButton onClick={closeButtonOnClick} icon={<X size={18} />} />
          </ToolBar>
        </SearchBarContainer>
      </NarrowLayout>
      <Placeholder />
    </Container>
  )
}

const Container = ({
  ref,
  overlayPosition,
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { overlayPosition: 'static' | 'absolute' } & {
  ref?: React.RefObject<HTMLDivElement | null>
}) => (
  <div
    ref={ref}
    className={classNames('z-[999] flex flex-row', className)}
    style={{
      position: overlayPosition,
      top: overlayPosition === 'absolute' ? '0' : 'auto',
      left: overlayPosition === 'absolute' ? '0' : 'auto',
      right: overlayPosition === 'absolute' ? '0' : 'auto',
      ...style
    }}
    {...props}
  />
)
Container.displayName = 'ContentSearchContainer'

const SearchBarContainer = ({
  position,
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { position: 'fixed' | 'absolute' | 'sticky' }) => (
  <div
    className={classNames(
      'mb-[5px] flex flex-[1_1_auto] items-center justify-center rounded-[10px] border border-[var(--color-primary)]',
      'bg-[var(--color-background)] px-[15px] py-[5px] transition-all duration-200 ease-in-out',
      className
    )}
    style={{ position, top: '15px', left: '20px', right: '20px', ...style }}
    {...props}
  />
)

const Placeholder = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={classNames('w-[5px]', className)} {...props} />
)

const InputWrapper = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={classNames('flex flex-[1_1_auto] items-center', className)} {...props} />
)

const Input = ({
  ref,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.RefObject<HTMLInputElement | null> }) => (
  <input
    ref={ref}
    className={classNames(
      'w-full flex-1 border-none bg-transparent px-[5px] py-0 font-[Ubuntu] text-[14px] text-foreground outline-none',
      className
    )}
    {...props}
  />
)
Input.displayName = 'ContentSearchInput'

const ToolBar = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={classNames('flex flex-row items-center', className)} {...props} />
)

const Separator = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={classNames('mx-[2px] h-[1.5em] w-px flex-[0_0_auto] bg-[var(--color-border)]', className)}
    {...props}
  />
)

const SearchResults = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={classNames(
      'mx-[2px] flex w-20 flex-[0_0_auto] justify-center font-[Ubuntu] text-[14px] text-foreground',
      className
    )}
    {...props}
  />
)

const SearchResultsPlaceholder = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={classNames('text-foreground opacity-50', className)} {...props} />
)

const SearchResultCount = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={classNames('text-foreground', className)} {...props} />
)

const SearchResultSeparator = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={classNames('mx-1 text-foreground', className)} {...props} />
)

const SearchResultTotalCount = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={classNames('text-foreground', className)} {...props} />
)
