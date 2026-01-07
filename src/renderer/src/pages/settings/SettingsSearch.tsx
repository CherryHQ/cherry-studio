import { Input } from 'antd'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import { ROUTE_MAPPING, ROUTE_TITLES, SEARCH_EXCLUDED_PREFIXES } from './SettingsSearchConfig'

interface SearchResult {
  key: string
  text: string
  route: string
  // The specific translation value to highlight
  highlightText: string
}

export const SettingsSearch = () => {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [showResults, setShowResults] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const navigate = useNavigate()
  const searchRef = useRef<HTMLDivElement>(null)

  // Flatten the translation object to find searchable strings
  const searchableItems = useMemo(() => {
    const items: SearchResult[] = []

    // Helper to recursively traverse the translation object
    const traverse = (obj: any, prefix: string) => {
      // Check if this prefix is in the exclusion list
      if (SEARCH_EXCLUDED_PREFIXES.some((excluded) => prefix.startsWith(excluded))) {
        return
      }

      if (typeof obj === 'string') {
        // Skip strings with placeholders like {{message}}, {{count}}, etc.
        if (obj.includes('{{')) {
          return
        }

        // Find the matching route prefix
        const mathedRoutePrefix = Object.keys(ROUTE_MAPPING).find((key) => prefix.startsWith(key))

        if (mathedRoutePrefix) {
          items.push({
            key: prefix,
            text: obj,
            route: ROUTE_MAPPING[mathedRoutePrefix],
            highlightText: obj
          })
        }
        return
      }

      if (typeof obj === 'object' && obj !== null) {
        Object.keys(obj).forEach((key) => {
          traverse(obj[key], prefix ? `${prefix}.${key}` : key)
        })
      }
    }

    // Get the current language resources
    // We try to get the full resource bundle.
    // Note: i18n.getResourceBundle might return the bundle if loaded.
    const bundle = i18n.getResourceBundle(i18n.language, 'translation') || {}
    traverse(bundle, '')

    return items
  }, [i18n.language]) // Re-calculate when language changes

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }

    const lowerQuery = query.toLowerCase()

    // Filter items that contain the query (case-insensitive)
    const filtered = searchableItems.filter((item) => item.text.toLowerCase().includes(lowerQuery))

    // Sort by relevance:
    // 1. Exact match (highest priority)
    // 2. Starts with query
    // 3. Contains query
    // Within each category, shorter text ranks higher
    const sorted = filtered.sort((a, b) => {
      const aLower = a.text.toLowerCase()
      const bLower = b.text.toLowerCase()

      const aExact = aLower === lowerQuery
      const bExact = bLower === lowerQuery

      // Exact match first
      if (aExact && !bExact) return -1
      if (!aExact && bExact) return 1

      const aStartsWith = aLower.startsWith(lowerQuery)
      const bStartsWith = bLower.startsWith(lowerQuery)

      // Starts with query second
      if (aStartsWith && !bStartsWith) return -1
      if (!aStartsWith && bStartsWith) return 1

      // Within same category, shorter text ranks higher
      return a.text.length - b.text.length
    })

    setResults(sorted.slice(0, 50)) // Limit to 50 results
    setSelectedIndex(0) // Reset selection when results change
  }, [query, searchableItems])

  // Handle outside click to close results
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (result: SearchResult) => {
    navigate(`${result.route}?highlight=${encodeURIComponent(result.text)}`)
    setShowResults(false)
    setQuery('') // Optional: clear query after selection
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showResults || results.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % results.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length)
        break
      case 'Enter':
        e.preventDefault()
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        setShowResults(false)
        break
    }
  }

  return (
    <SearchContainer ref={searchRef}>
      <Input
        placeholder={t('settings.search_placeholder', 'Search settings')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setShowResults(true)
        }}
        onFocus={() => setShowResults(true)}
        onKeyDown={handleKeyDown}
        style={{ borderRadius: 'var(--list-item-border-radius)', height: 35 }}
        suffix={<Search size={14} color="var(--color-text-2)" />}
        allowClear
      />

      {showResults && results.length > 0 && (
        <ResultsDropdown>
          {results.map((result, index) => (
            <ResultItem
              key={result.key}
              onClick={() => handleSelect(result)}
              className={index === selectedIndex ? 'selected' : ''}>
              <ResultText>{result.text}</ResultText>
              <ResultPath>{t(ROUTE_TITLES[result.route])}</ResultPath>
            </ResultItem>
          ))}
        </ResultsDropdown>
      )}
    </SearchContainer>
  )
}

const SearchContainer = styled.div`
  position: relative;
  border-bottom: 0.5px solid var(--color-border);
  /* Padding to match ProviderList style - though ProviderList has 10px 8px padding wrapper. 
     Here we are inside SettingsMenus which has padding: 10px. 
     So we might just want to be a block that fits.
     However, the original SearchContainer had padding 10px. 
     Let's keep some padding or margin.
  */
  padding-bottom: 10px;
  margin-bottom: 5px;
`

const ResultsDropdown = styled.div`
  position: absolute;
  top: 100%;
  left: 0; 
  right: 0;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  max-height: 300px;
  overflow-y: auto;
  z-index: 1000;
  margin-top: 5px;
`

const ResultItem = styled.div`
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--color-border-soft);

  &:last-child {
    border-bottom: none;
  }

  &:hover,
  &.selected {
    background: var(--color-background-soft);
  }
`

const ResultText = styled.div`
  font-size: 13px;
  color: var(--color-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  margin-right: 8px;
`

const ResultPath = styled.div`
  font-size: 10px;
  color: var(--color-text-3);
  background: var(--color-background-soft);
  padding: 2px 6px;
  border-radius: 4px;
`
