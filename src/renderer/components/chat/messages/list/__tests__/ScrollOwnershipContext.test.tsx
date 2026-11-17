import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useIsScrollViewportOwned, useScrollViewportOwnership } from '@renderer/hooks/useScrollViewportOwnership'

import { ScrollOwnershipProvider, useIsScrollRuntimeManaged } from '../ScrollOwnershipContext'

describe('scroll viewport ownership', () => {
  it('provides ownership only for the exact container', () => {
    const element = document.createElement('div')
    const other = document.createElement('div')
    const renders: boolean[][] = []
    const Consumer = () => {
      const isOwned = useIsScrollViewportOwned()
      renders.push([isOwned(element), isOwned(other), isOwned(null)])
      return null
    }
    render(
      <ScrollOwnershipProvider scrollContainerRef={{ current: element }}>
        <Consumer />
      </ScrollOwnershipProvider>
    )
    expect(renders).toHaveLength(1)
    expect(renders[0]).toEqual([true, false, false])
  })

  it('agrees with the chat accessor for owned and unowned elements', () => {
    const element = document.createElement('div')
    const other = document.createElement('div')
    const results: boolean[][] = []
    const Consumer = () => {
      const isOwned = useIsScrollViewportOwned()
      const isManaged = useIsScrollRuntimeManaged()
      results.push([isOwned(element), isManaged(element), isOwned(other), isManaged(other)])
      return null
    }
    render(
      <ScrollOwnershipProvider scrollContainerRef={{ current: element }}>
        <Consumer />
      </ScrollOwnershipProvider>
    )
    expect(results).toEqual([[true, true, false, false]])
  })

  it('reads a ref assigned after render without rerendering', () => {
    const element = document.createElement('div')
    const scrollContainerRef: { current: HTMLElement | null } = { current: null }
    const predicates: Array<(container: HTMLElement | null) => boolean> = []
    const Consumer = () => {
      predicates.push(useIsScrollViewportOwned())
      return null
    }
    render(
      <ScrollOwnershipProvider scrollContainerRef={scrollContainerRef}>
        <Consumer />
      </ScrollOwnershipProvider>
    )
    expect(predicates).toHaveLength(1)
    expect(predicates[0](element)).toBe(false)
    scrollContainerRef.current = element
    expect(predicates[0](element)).toBe(true)
    expect(predicates).toHaveLength(1)
  })

  it('safely reports no ownership without a provider', () => {
    const element = document.createElement('div')
    const results: Array<[ReturnType<typeof useScrollViewportOwnership>, boolean, boolean]> = []
    const Consumer = () => {
      const ownership = useScrollViewportOwnership()
      const isOwned = useIsScrollViewportOwned()
      results.push([ownership, isOwned(element), isOwned(null)])
      return null
    }
    render(<Consumer />)
    expect(results).toEqual([[null, false, false]])
  })
})
