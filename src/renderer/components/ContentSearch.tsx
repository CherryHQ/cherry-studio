import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ActionIconButton from '@renderer/components/ActionIconButton'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import { scrollElementIntoView } from '@renderer/utils/dom'
import { classNames } from '@renderer/utils/style'
import { debounce } from 'es-toolkit/compat'
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
  /**
   * Whether the bar follows the chat narrow-mode width (default: true). Surfaces
   * outside chat should opt out — `chat.narrow_mode` has no business deciding how
   * wide, say, the notes find bar is.
   */
  followChatNarrowMode?: boolean
  /**
   * 'stretch' (default) spans the available width; 'compact' pins a fixed-width bar to
   * the trailing edge, the way an editor find widget sits in the top-right corner
   * instead of covering the line it is searching.
   */
  widthMode?: 'stretch' | 'compact'
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
  /**
   * Highlight `text` without revealing the search bar, for a search UI that lives
   * outside this component (e.g. the notes sidebar) — the VS Code arrangement, where
   * panel results highlight in the editor but do not open its find widget.
   *
   * An empty `text` clears the highlights. Matching options are taken from
   * `options`, never from the bar's own toggles, so the outside UI and this one
   * cannot silently disagree about what counts as a match.
   */
  highlightExternal(text: string, options?: ExternalHighlightOptions): void
}

export interface ExternalHighlightOptions {
  /**
   * Ordinal of the match to emphasise and scroll to, counted among the matches
   * inside `scope`. Omitted (or negative) emphasises none, so typing highlights
   * every hit without yanking the viewport around.
   */
  activeIndex?: number
  /**
   * Restricts `activeIndex` to matches inside this element. An ordinal computed
   * from a different representation of the document (e.g. markdown source, whose
   * syntax characters are not rendered) cannot be trusted document-wide, but is
   * reliable within the one block the caller resolved.
   */
  scope?: HTMLElement | null
  /**
   * How many hits the caller's own representation found in the unit `scope` is meant
   * to stand for. `scope` resolves to a top-level rendered block, which need not
   * correspond 1:1 to that unit — a list or table is one block for many source lines,
   * and source-only text (a link URL) yields no rendered hit at all. When the counts
   * disagree the ordinal is meaningless, so it is ignored rather than guessed with.
   */
  expectedScopeMatches?: number
  caseSensitive?: boolean
  wholeWord?: boolean
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
  followChatNarrowMode = true,
  widthMode = 'stretch',
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
  // Mirrors `enableContentSearch` but updates synchronously. `disable()` has to hand
  // the highlight back to the external owner in the same tick it hides the bar, and a
  // state read there would still say "visible" and skip the handover.
  const barVisibleRef = useRef(false)
  const [searchCompleted, setSearchCompleted] = useState(SearchCompletedState.NotSearched)
  const [isCaseSensitive, setIsCaseSensitive] = useState(false)
  const [isWholeWord, setIsWholeWord] = useState(false)
  const [allRanges, setAllRanges] = useState<Range[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [narrowMode] = usePreference('chat.narrow_mode')
  const prevSearchText = useRef('')
  // The keyword an outside search UI asked us to highlight; kept so closing the find
  // bar restores it instead of wiping a highlight the bar never owned.
  const externalKeywordRef = useRef('')
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

  const applyExternalHighlight = useCallback(
    (text: string, options: ExternalHighlightOptions = {}) => {
      const { activeIndex = -1, scope, expectedScopeMatches, caseSensitive = false, wholeWord = false } = options
      const trimmed = text.trim()
      const previousExternal = externalKeywordRef.current
      externalKeywordRef.current = trimmed

      // Ownership rule: an open find bar owns the highlight. Record the request and let
      // `disable()` apply the latest one on close — otherwise a sidebar search finishing
      // (or any markdown edit) would overwrite the query the user typed here.
      if (barVisibleRef.current) {
        // Navigation is not highlight, though: a click on an outside result must still
        // take the reader to the block, or it would look like the click did nothing.
        if (scope) {
          scrollElementIntoView(scope, target)
        }
        return
      }

      if (trimmed === '') {
        // Only the term WE seeded is ours to clear; anything else in the input was typed
        // into the bar and must survive the outside UI dropping its keyword. (A visible
        // bar never reaches here — it owns the highlight and returned above.)
        const barQuery = searchInputRef.current?.value.trim() ?? ''
        if (searchInputRef.current && barQuery === previousExternal) {
          searchInputRef.current.value = ''
        }
        resetSearch()
        return
      }

      // Seed the bar's input so Cmd+F continues from the same term. Only on a real
      // keyword — clearing here would erase whatever the user had typed.
      if (searchInputRef.current) {
        searchInputRef.current.value = trimmed
      }

      if (!target) {
        resetSearch()
        return
      }

      // Deliberately NOT the bar's isCaseSensitive/isWholeWord: those belong to the
      // editor's own find widget, and inheriting them would make this highlight
      // disagree with the result list of the UI that asked for it.
      const ranges = findRangesInTarget(target, filter, trimmed, caseSensitive, wholeWord)
      setSearchCompleted(SearchCompletedState.Searched)
      setAllRanges(ranges)

      if (ranges.length === 0 || activeIndex < 0) {
        setCurrentIndex(-1)
        return
      }

      if (!scope) {
        setCurrentIndex(Math.min(activeIndex, ranges.length - 1))
        return
      }

      // Resolve the ordinal against the matches inside `scope` only, then map back to
      // its document-wide position (which is what currentIndex addresses).
      const scopedPositions = ranges.reduce<number[]>((positions, range, index) => {
        if (scope.contains(range.startContainer)) {
          positions.push(index)
        }
        return positions
      }, [])

      // Trust the ordinal only when the rendered block yielded exactly the hits the
      // caller counted. Any disagreement means `scope` is not the unit the ordinal was
      // counted in, so pointing at one of its hits would be a guess: land on the block
      // and leave every hit equally highlighted instead.
      const scopeMatchesSource = expectedScopeMatches === undefined || expectedScopeMatches === scopedPositions.length
      if (scopedPositions.length === 0 || activeIndex >= scopedPositions.length || !scopeMatchesSource) {
        setCurrentIndex(-1)
        scrollElementIntoView(scope, target)
        return
      }

      setCurrentIndex(scopedPositions[activeIndex])
    },
    [target, filter, resetSearch]
  )

  const implementation = useMemo(
    () => ({
      disable: () => {
        barVisibleRef.current = false
        setEnableContentSearch(false)
        CSS.highlights.clear()
        // The highlights are a document-wide registry, so clearing them also drops any
        // highlight an outside search UI owns. Put that one back.
        if (externalKeywordRef.current) {
          applyExternalHighlight(externalKeywordRef.current)
        }
      },
      enable: (initialText?: string) => {
        barVisibleRef.current = true
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
            // A term may already be there (an outside search seeded it); the
            // enableContentSearch effect below re-runs the search for it on open.
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
      },
      highlightExternal: applyExternalHighlight
    }),
    [allRanges.length, locateByIndex, search, applyExternalHighlight]
  )

  // `implementation` is rebuilt whenever allRanges/currentIndex change — i.e. after
  // every search — so binding the debounce to it produced a fresh debounced function
  // per keystroke and orphaned the pending timer, defeating the debounce entirely.
  // Call through a ref so the debounced instance is created once.
  const searchImplRef = useRef(implementation.search)
  searchImplRef.current = implementation.search
  const _searchHandlerDebounce = useMemo(() => debounce(() => searchImplRef.current(), 300), [])

  const searchHandler = useCallback(() => {
    _searchHandlerDebounce()
  }, [_searchHandlerDebounce])

  // The debounced instance now outlives every render, so a pending timer would still
  // fire after unmount and search a torn-down target.
  useEffect(() => () => _searchHandlerDebounce.cancel(), [_searchHandlerDebounce])

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
      <NarrowLayout narrowMode={followChatNarrowMode && narrowMode} style={{ width: '100%' }}>
        <SearchBarContainer position={positionMode} widthMode={widthMode}>
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
                      <User size={18} style={{ color: includeUser ? 'var(--primary)' : 'var(--muted-foreground)' }} />
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
                      style={{
                        color: isCaseSensitive ? 'var(--primary)' : 'var(--muted-foreground)'
                      }}
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
                      style={{ color: isWholeWord ? 'var(--primary)' : 'var(--muted-foreground)' }}
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

const COMPACT_SEARCH_BAR_WIDTH = '420px'

const SearchBarContainer = ({
  position,
  widthMode,
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  position: 'fixed' | 'absolute' | 'sticky'
  widthMode: 'stretch' | 'compact'
}) => (
  <div
    className={classNames(
      // A floating panel takes bg-popover + border-border + a shadow (DESIGN.md §Floating
      // Scrims); the brand colour is for action hierarchy, not for chrome outlines.
      'mb-[5px] flex flex-[1_1_auto] items-center rounded-lg border border-border',
      'bg-popover px-[15px] py-[5px] shadow-lg transition-all duration-200 ease-in-out',
      widthMode === 'compact' ? 'justify-start' : 'justify-center',
      className
    )}
    style={{
      position,
      top: '15px',
      right: '20px',
      // Compact keeps the trailing edge and drops the leading one, so the bar sizes to
      // itself; the max-width keeps it inside a narrow editor.
      left: widthMode === 'compact' ? 'auto' : '20px',
      width: widthMode === 'compact' ? COMPACT_SEARCH_BAR_WIDTH : undefined,
      maxWidth: widthMode === 'compact' ? 'calc(100% - 40px)' : undefined,
      ...style
    }}
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
      'w-full flex-1 border-none bg-transparent px-[5px] py-0 text-foreground text-sm outline-none',
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
  <div className={classNames('mx-[2px] h-[1.5em] w-px flex-[0_0_auto] bg-border', className)} {...props} />
)

const SearchResults = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={classNames('mx-[2px] flex w-20 flex-[0_0_auto] justify-center text-foreground text-sm', className)}
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
