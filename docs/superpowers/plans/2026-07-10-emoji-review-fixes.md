# Emoji Review Fixes Implementation Plan

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** Preserve existing Unicode avatar identity, render Fluent artwork when available, virtualize the emoji picker, restore package compatibility exports, and fix decorative accessibility behavior.

**架构：** `EmojiGlyph` remains the only Fluent lookup boundary and owns the Unicode fallback. Renderer code passes stored emoji through unchanged, while the picker flattens headers and seven-item grid rows for TanStack virtualization. The dedicated Fluent package entry remains isolated; lightweight legacy components are restored only for root/components API compatibility.

**技术栈：** React 19, TypeScript, Vitest, Testing Library, `@tanstack/react-virtual`, `@cherrystudio/ui`, Tailwind CSS.

---

## File Structure

- Modify `packages/ui/src/fluent-emoji.tsx`: preserve unmapped Unicode and apply wrapper accessibility semantics.
- Modify `packages/ui/src/components/primitives/emoji-glyph/__tests__/emoji-glyph.test.tsx`: cover mapped/unmapped decorative behavior.
- Modify `packages/ui/src/components/primitives/__tests__/emoji-icon.test.tsx`: cover Fluent `EmojiIcon` Unicode fallback.
- Modify `packages/ui/src/components/composites/emoji-avatar/__tests__/emoji-avatar.test.tsx`: cover Fluent `EmojiAvatar` Unicode fallback.
- Restore `packages/ui/src/components/primitives/emoji-icon.tsx`: lightweight compatibility implementation.
- Restore `packages/ui/src/components/composites/emoji-avatar/index.tsx`: lightweight compatibility implementation.
- Modify `packages/ui/src/components/index.ts`: restore root/components compatibility exports.
- Create `packages/ui/src/components/__tests__/emoji-compatibility-exports.test.tsx`: verify public imports and native compatibility behavior.
- Modify `src/renderer/components/EmojiPicker/data.ts`: retain all valid groups 0-8 emoji.
- Modify `src/renderer/components/EmojiPicker/useRecentEmojis.ts`: stop filtering and rewriting persisted recents.
- Modify `src/renderer/components/EmojiPicker/EmojiPicker.tsx`: flatten and virtualize picker rows.
- Modify `src/renderer/components/EmojiPicker/__tests__/data.test.ts`: cover unmapped picker options.
- Modify `src/renderer/components/EmojiPicker/__tests__/useRecentEmojis.test.ts`: cover unmapped persisted and pushed recents.
- Modify `src/renderer/components/EmojiPicker/__tests__/EmojiPicker.test.tsx`: cover virtual row count and visible-window rendering.
- Modify `src/renderer/components/Sidebar/primitives.tsx`: render any valid emoji through `EmojiIcon`.
- Modify renderer regression tests that currently expect unsupported emoji replacement: Sidebar, history, resource cards, resource selector, and renderer `EmojiIcon` tests.

### Task 1: Preserve Unicode fallback and fix decorative semantics

**Files:**
- Modify: `packages/ui/src/components/primitives/emoji-glyph/__tests__/emoji-glyph.test.tsx`
- Modify: `packages/ui/src/components/primitives/__tests__/emoji-icon.test.tsx`
- Modify: `packages/ui/src/components/composites/emoji-avatar/__tests__/emoji-avatar.test.tsx`
- Modify: `packages/ui/src/fluent-emoji.tsx`

- [ ] **Step 1: Write failing glyph accessibility and fallback tests**

Add these cases to the existing Fluent tests:

```tsx
it('hides the mapped glyph wrapper when decorative', () => {
  const { container } = render(<EmojiGlyph emoji="🤖" decorative aria-label="robot" />)

  expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  expect(container.querySelector('.sr-only')).not.toBeInTheDocument()
})

it.each(['👨‍👩‍👧‍👦', '👍🏽', '🇨🇳'])('preserves unmapped Unicode emoji %s', (emoji) => {
  const { container } = render(<EmojiIcon emoji={emoji} fallbackEmoji="🤖" />)

  expect(container.querySelector('svg[data-fluent-emoji="🤖"]')).not.toBeInTheDocument()
  expect(container).toHaveTextContent(emoji)
})

it('preserves unmapped Unicode children instead of substituting the fallback', () => {
  const emoji = '👨‍👩‍👧‍👦'
  const { container } = render(<EmojiAvatar fallbackEmoji="🤖">{emoji}</EmojiAvatar>)

  expect(container.querySelector('svg[data-fluent-emoji="🤖"]')).not.toBeInTheDocument()
  expect(container).toHaveTextContent(emoji)
})
```

- [ ] **Step 2: Run the focused UI tests and verify RED**

Run:

```bash
pnpm exec vitest run --project ui \
  packages/ui/src/components/primitives/emoji-glyph/__tests__/emoji-glyph.test.tsx \
  packages/ui/src/components/primitives/__tests__/emoji-icon.test.tsx \
  packages/ui/src/components/composites/emoji-avatar/__tests__/emoji-avatar.test.tsx
```

Expected: FAIL because mapped decorative wrappers lack `aria-hidden` and `EmojiIcon`/`EmojiAvatar` substitute fallback artwork for unmapped Unicode.

- [ ] **Step 3: Implement the minimum fallback contract**

In `packages/ui/src/fluent-emoji.tsx`, remove the private emoji-validation regex and make fallback selection apply only to empty input:

```ts
export function getFluentEmojiOrFallback(
  emoji: string | null | undefined,
  fallbackEmoji: string = DEFAULT_FLUENT_EMOJI
): string {
  return emoji?.trim() || fallbackEmoji
}
```

In the mapped `EmojiGlyph` branch, apply the same wrapper attribute order as the Unicode branch:

```tsx
<span
  className={cn('inline-flex items-center justify-center leading-none', className)}
  {...props}
  aria-hidden={decorative ? true : props['aria-hidden']}>
```

Keep `EmojiIcon`'s existing empty-string behavior so its foreground remains empty and its blurred background still uses the star.

- [ ] **Step 4: Run the focused UI tests and verify GREEN**

Run the command from Step 2.

Expected: all selected UI tests PASS with no warnings.

- [ ] **Step 5: Commit the fallback unit**

```bash
git add packages/ui/src/fluent-emoji.tsx \
  packages/ui/src/components/primitives/emoji-glyph/__tests__/emoji-glyph.test.tsx \
  packages/ui/src/components/primitives/__tests__/emoji-icon.test.tsx \
  packages/ui/src/components/composites/emoji-avatar/__tests__/emoji-avatar.test.tsx
git commit --signoff -m "fix(ui-emoji): preserve unicode fallback"
```

### Task 2: Preserve picker options, recents, and renderer avatars

**Files:**
- Modify: `src/renderer/components/EmojiPicker/__tests__/data.test.ts`
- Modify: `src/renderer/components/EmojiPicker/__tests__/useRecentEmojis.test.ts`
- Modify: `src/renderer/components/Sidebar/__tests__/primitives.test.tsx`
- Modify: `src/renderer/pages/history/__tests__/historyRecordsHelpers.test.tsx`
- Modify: `src/renderer/components/resourceCatalog/catalog/__tests__/ResourceGrid.test.tsx`
- Modify: `src/renderer/components/resourceCatalog/selectors/__tests__/ResourceSelectorShell.test.tsx`
- Modify: `src/renderer/components/__tests__/EmojiIcon.test.tsx`
- Modify: `src/renderer/components/EmojiPicker/data.ts`
- Modify: `src/renderer/components/EmojiPicker/useRecentEmojis.ts`
- Modify: `src/renderer/components/Sidebar/primitives.tsx`

- [ ] **Step 1: Rewrite regression expectations to the approved behavior**

Update tests so unsupported valid emoji remain visible. The key expectations are:

```ts
await expect(loadStableEmojiOptions('en-US')).resolves.toEqual([
  { emoji: '😀', annotation: 'grinning face', group: 0, order: 1, version: 1 },
  { emoji: '👨‍👩‍👧‍👦', annotation: 'family', group: 0, order: 2, version: 2 },
  { emoji: '🫠', annotation: 'melting face', group: 0, order: 3, version: 14 }
])
```

```ts
it('preserves unmapped persisted emojis without rewriting the cache', () => {
  const emoji = '👨‍👩‍👧‍👦'
  MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠', emoji, '📁'])

  const { result } = renderHook(() => useRecentEmojis())

  expect(result.current.recent).toEqual(['🧠', emoji, '📁'])
  expect(MockUseCacheUtils.getPersistCacheValue('ui.emoji.recently_used')).toEqual(['🧠', emoji, '📁'])
})
```

```ts
it('renders an unmapped emoji avatar instead of the user initial', () => {
  const emoji = '👨‍👩‍👧‍👦'
  const { container } = render(<UserAvatar user={{ name: 'User', avatar: emoji }} />)

  expect(container).toHaveTextContent(emoji)
  expect(screen.queryByText('U')).not.toBeInTheDocument()
})
```

Apply the same native-text expectation to history, resource-card, resource-selector, and renderer `EmojiIcon` tests.

- [ ] **Step 2: Run the focused renderer tests and verify RED**

Run:

```bash
pnpm exec vitest run --project renderer \
  src/renderer/components/EmojiPicker/__tests__/data.test.ts \
  src/renderer/components/EmojiPicker/__tests__/useRecentEmojis.test.ts \
  src/renderer/components/Sidebar/__tests__/primitives.test.tsx \
  src/renderer/pages/history/__tests__/historyRecordsHelpers.test.tsx \
  src/renderer/components/resourceCatalog/catalog/__tests__/ResourceGrid.test.tsx \
  src/renderer/components/resourceCatalog/selectors/__tests__/ResourceSelectorShell.test.tsx \
  src/renderer/components/__tests__/EmojiIcon.test.tsx
```

Expected: FAIL because picker data and recents still filter unmapped emoji and Sidebar still routes them to initials.

- [ ] **Step 3: Remove Fluent-coverage filtering**

In `data.ts`, remove `hasFluentEmojiIcon` and retain only the existing group boundary:

```ts
.then((records) => records.filter((record) => record.group < 9))
```

In `useRecentEmojis.ts`, restore the direct persisted list and deduping update:

```ts
export const useRecentEmojis = () => {
  const [recent, setRecent] = usePersistCache('ui.emoji.recently_used')

  const pushRecent = useCallback(
    (emoji: string) => {
      setRecent((prev) => [emoji, ...prev.filter((item) => item !== emoji)].slice(0, MAX_RECENT_EMOJIS))
    },
    [setRecent]
  )

  const clearRecent = useCallback(() => setRecent([]), [setRecent])

  return { recent, pushRecent, clearRecent }
}
```

In Sidebar, remove the Fluent-coverage condition:

```ts
const isEmojiAvatar = user.avatar ? isEmoji(user.avatar) : false
```

- [ ] **Step 4: Run the focused renderer tests and verify GREEN**

Run the command from Step 2.

Expected: all selected renderer tests PASS.

- [ ] **Step 5: Commit the renderer behavior unit**

```bash
git add src/renderer/components/EmojiPicker/data.ts \
  src/renderer/components/EmojiPicker/useRecentEmojis.ts \
  src/renderer/components/EmojiPicker/__tests__/data.test.ts \
  src/renderer/components/EmojiPicker/__tests__/useRecentEmojis.test.ts \
  src/renderer/components/Sidebar/primitives.tsx \
  src/renderer/components/Sidebar/__tests__/primitives.test.tsx \
  src/renderer/pages/history/__tests__/historyRecordsHelpers.test.tsx \
  src/renderer/components/resourceCatalog/catalog/__tests__/ResourceGrid.test.tsx \
  src/renderer/components/resourceCatalog/selectors/__tests__/ResourceSelectorShell.test.tsx \
  src/renderer/components/__tests__/EmojiIcon.test.tsx
git commit --signoff -m "fix(emoji-rendering): preserve stored emoji identity"
```

### Task 3: Virtualize picker rows

**Files:**
- Modify: `src/renderer/components/EmojiPicker/__tests__/EmojiPicker.test.tsx`
- Modify: `src/renderer/components/EmojiPicker/EmojiPicker.tsx`

- [ ] **Step 1: Add a controllable TanStack virtualizer mock**

Add a hoisted mock whose `visibleIndexes` can restrict mounted rows:

```ts
type VirtualizerOptionsMock = {
  count: number
  estimateSize: (index: number) => number
  rangeExtractor?: (range: { startIndex: number; endIndex: number; overscan: number; count: number }) => number[]
}

const virtualizerMocks = vi.hoisted(() => ({
  visibleIndexes: undefined as number[] | undefined,
  useVirtualizer: vi.fn((options: VirtualizerOptionsMock) => {
    const indexes = virtualizerMocks.visibleIndexes ?? Array.from({ length: options.count }, (_, index) => index)
    return {
      getTotalSize: () => options.count * 44,
      getVirtualItems: () => indexes.map((index) => ({ index, key: index, size: 44, start: index * 44 })),
      measureElement: vi.fn()
    }
  })
}))
```

Mock `useVirtualizer` and `defaultRangeExtractor`, reset `visibleIndexes` in `beforeEach`, then add a test with 20 group-0 emoji. Assert the virtualizer receives four rows (one header plus three seven-column rows), expose only indexes `[0, 1]`, and verify emoji 1 is mounted while emoji 8 is not.

- [ ] **Step 2: Run the picker test and verify RED**

Run:

```bash
pnpm exec vitest run --project renderer src/renderer/components/EmojiPicker/__tests__/EmojiPicker.test.tsx
```

Expected: FAIL because `EmojiPicker` does not call `useVirtualizer` and mounts all emoji.

- [ ] **Step 3: Implement flattened row virtualization**

In `EmojiPicker.tsx`:

1. Add a `Scrollbar` ref.
2. Build a memoized discriminated row array containing headers and seven-item grids.
3. Record header indexes.
4. Use `defaultRangeExtractor` plus the active header index to retain the current sticky header.
5. Configure `useVirtualizer` with the scrollbar, measured rows, and `overscan: 3`.
6. Render virtual rows in a relative-height container; grid rows keep the existing button markup and `EmojiGlyph` rendering.

Update the React and virtualizer imports exactly as follows:

```ts
import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
```

Use these row types and estimates:

```ts
const EMOJI_COLUMNS = 7
const HEADER_ROW_ESTIMATE_PX = 30
const EMOJI_ROW_ESTIMATE_PX = 43

type EmojiPickerRow =
  | { key: string; type: 'header'; title: string }
  | { key: string; type: 'emoji'; emojis: EmojiOption[] }

type EmojiOption = Pick<EmojiRecord, 'emoji'> & Partial<EmojiRecord>
```

Build the row model and virtualizer inside `EmojiPicker` with this code:

```tsx
const scrollRef = useRef<HTMLDivElement>(null)
const activeStickyIndexRef = useRef(-1)

const rows = useMemo(() => {
  const nextRows: EmojiPickerRow[] = []

  const appendSection = (key: string, title: string, options: EmojiOption[]) => {
    if (options.length === 0) return
    nextRows.push({ key: `${key}-header`, type: 'header', title })
    for (let index = 0; index < options.length; index += EMOJI_COLUMNS) {
      nextRows.push({
        key: `${key}-row-${index / EMOJI_COLUMNS}`,
        type: 'emoji',
        emojis: options.slice(index, index + EMOJI_COLUMNS)
      })
    }
  }

  appendSection(
    'recent',
    t(RECENT_CATEGORY_LABEL_KEY),
    recent.map((emoji) => ({ emoji }))
  )
  for (const { group, labelKey } of EMOJI_CATEGORIES) {
    appendSection(`group-${group}`, t(labelKey), groupedEmojis.get(group) ?? [])
  }

  return nextRows
}, [groupedEmojis, recent, t])

const stickyIndexes = useMemo(
  () => rows.flatMap((row, index) => (row.type === 'header' ? [index] : [])),
  [rows]
)

const rangeExtractor = useCallback(
  (range: Range) => {
    let activeStickyIndex = -1
    for (const index of stickyIndexes) {
      if (index > range.startIndex) break
      activeStickyIndex = index
    }
    activeStickyIndexRef.current = activeStickyIndex

    const indexes = defaultRangeExtractor(range)
    if (activeStickyIndex < 0) return indexes
    return [...new Set([activeStickyIndex, ...indexes])].sort((left, right) => left - right)
  },
  [stickyIndexes]
)

const rowVirtualizer = useVirtualizer({
  count: rows.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: (index) => (rows[index]?.type === 'header' ? HEADER_ROW_ESTIMATE_PX : EMOJI_ROW_ESTIMATE_PX),
  overscan: 3,
  rangeExtractor
})
```

Replace the current section rendering with this virtual container:

```tsx
<Scrollbar ref={scrollRef} className="min-h-0 flex-1 overscroll-contain px-2.5 pb-2">
  <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
      const row = rows[virtualRow.index]
      if (!row) return null

      const isActiveHeader = row.type === 'header' && activeStickyIndexRef.current === virtualRow.index
      return (
        <div
          key={row.key}
          ref={rowVirtualizer.measureElement}
          data-index={virtualRow.index}
          className={cn('left-0 w-full', isActiveHeader ? 'sticky top-0 z-10' : 'absolute top-0')}
          style={{ transform: isActiveHeader ? undefined : `translateY(${virtualRow.start}px)` }}>
          {row.type === 'header' ? (
            <h3
              className={cn(
                'bg-card py-1.5 font-semibold text-foreground text-xs',
                virtualRow.index > 0 && 'pt-3'
              )}>
              {row.title}
            </h3>
          ) : (
            <EmojiGrid emojis={row.emojis} onPick={handleEmojiPick} />
          )}
        </div>
      )
    })}
  </div>
</Scrollbar>
```

Do not add search, tabs, dynamic imports, or a second virtualization abstraction.

- [ ] **Step 4: Run the picker test and verify GREEN**

Run the command from Step 2.

Expected: all picker tests PASS, including click behavior for a mounted row.

- [ ] **Step 5: Commit the performance unit**

```bash
git add src/renderer/components/EmojiPicker/EmojiPicker.tsx \
  src/renderer/components/EmojiPicker/__tests__/EmojiPicker.test.tsx
git commit --signoff -m "perf(emoji-picker): virtualize glyph rows"
```

### Task 4: Restore public package compatibility

**Files:**
- Restore: `packages/ui/src/components/primitives/emoji-icon.tsx`
- Restore: `packages/ui/src/components/composites/emoji-avatar/index.tsx`
- Modify: `packages/ui/src/components/index.ts`
- Create: `packages/ui/src/components/__tests__/emoji-compatibility-exports.test.tsx`

- [ ] **Step 1: Write a failing compatibility export test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { EmojiAvatar as ComponentsEmojiAvatar, EmojiIcon as ComponentsEmojiIcon } from '@cherrystudio/ui/components'
import { EmojiAvatar, EmojiIcon } from '@cherrystudio/ui'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('emoji compatibility exports', () => {
  it.each([
    ['root', EmojiIcon, EmojiAvatar],
    ['components', ComponentsEmojiIcon, ComponentsEmojiAvatar]
  ])('keeps %s imports available with native rendering', (_entry, Icon, Avatar) => {
    const { container } = render(
      <>
        <Icon emoji="👨‍👩‍👧‍👦" />
        <Avatar>🇨🇳</Avatar>
      </>
    )

    expect(container).toHaveTextContent('👨‍👩‍👧‍👦')
    expect(container).toHaveTextContent('🇨🇳')
    expect(container.querySelector('svg[data-fluent-emoji]')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the compatibility test and verify RED**

Run:

```bash
pnpm exec vitest run --project ui packages/ui/src/components/__tests__/emoji-compatibility-exports.test.tsx
```

Expected: FAIL at module import because the barrel exports are absent.

- [ ] **Step 3: Restore lightweight compatibility implementations and exports**

Restore `packages/ui/src/components/primitives/emoji-icon.tsx` with its previous native implementation:

```tsx
import type { CSSProperties, FC } from 'react'

interface EmojiIconProps {
  emoji: string
  className?: string
  size?: number
  fontSize?: number
  fluid?: boolean
}

const EmojiIcon: FC<EmojiIconProps> = ({ emoji, className = '', size = 26, fontSize = 15, fluid = false }) => {
  const wrapperStyle: CSSProperties = fluid
    ? { fontSize: `${fontSize}px` }
    : {
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${size / 2}px`,
        fontSize: `${fontSize}px`
      }

  return (
    <div
      className={`flex items-center justify-center flex-shrink-0 relative overflow-hidden rounded-full ${fluid ? 'h-full w-full' : 'mr-1'} ${className}`}
      style={wrapperStyle}>
      <div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center blur-sm opacity-40"
        style={{ fontSize: '200%', transform: 'scale(1.5)' }}>
        {emoji || '⭐️'}
      </div>
      {emoji}
    </div>
  )
}

export default EmojiIcon
```

Restore `packages/ui/src/components/composites/emoji-avatar/index.tsx` with its previous native implementation:

```tsx
import { cn } from '@cherrystudio/ui/lib/utils'
import React, { memo } from 'react'

interface EmojiAvatarProps {
  children: string
  size?: number
  fontSize?: number
  onClick?: React.MouseEventHandler<HTMLDivElement>
  className?: string
  style?: React.CSSProperties
}

const EmojiAvatar = ({ children, size = 31, fontSize, onClick, className, style }: EmojiAvatarProps) => (
  <div
    onClick={onClick}
    className={cn(
      'flex items-center justify-center',
      'bg-background-soft border-border',
      'rounded-[20%] cursor-pointer',
      'transition-opacity hover:opacity-80',
      'border-[0.5px]',
      className
    )}
    style={{ width: size, height: size, fontSize: fontSize ?? size * 0.5, ...style }}>
    {children}
  </div>
)

EmojiAvatar.displayName = 'EmojiAvatar'

export default memo(EmojiAvatar)
```

Restore these barrel lines:

```ts
export { default as EmojiIcon } from './primitives/emoji-icon'
export { default as EmojiAvatar } from './composites/emoji-avatar'
```

Keep all application call sites on `@cherrystudio/ui/fluent-emoji`; do not re-export the heavy Fluent module through the root barrel.

- [ ] **Step 4: Run the compatibility test and UI build**

```bash
pnpm exec vitest run --project ui packages/ui/src/components/__tests__/emoji-compatibility-exports.test.tsx
pnpm --filter @cherrystudio/ui build
```

Expected: test PASS; build exits 0; `dist/index.*` and `dist/components/index.*` export both compatibility symbols without embedding the Fluent dataset.

- [ ] **Step 5: Commit the compatibility unit**

```bash
git add packages/ui/src/components/index.ts \
  packages/ui/src/components/primitives/emoji-icon.tsx \
  packages/ui/src/components/composites/emoji-avatar/index.tsx \
  packages/ui/src/components/__tests__/emoji-compatibility-exports.test.tsx
git commit --signoff -m "fix(ui): restore emoji compatibility exports"
```

### Task 5: Verify the complete change

**Files:**
- Inspect: all files changed by Tasks 1-4

- [ ] **Step 1: Run all focused emoji tests together**

```bash
pnpm exec vitest run --project ui \
  packages/ui/src/components/primitives/emoji-glyph/__tests__/emoji-glyph.test.tsx \
  packages/ui/src/components/primitives/__tests__/emoji-icon.test.tsx \
  packages/ui/src/components/composites/emoji-avatar/__tests__/emoji-avatar.test.tsx \
  packages/ui/src/components/__tests__/emoji-compatibility-exports.test.tsx

pnpm exec vitest run --project renderer \
  src/renderer/components/EmojiPicker/__tests__/data.test.ts \
  src/renderer/components/EmojiPicker/__tests__/useRecentEmojis.test.ts \
  src/renderer/components/EmojiPicker/__tests__/EmojiPicker.test.tsx \
  src/renderer/components/Sidebar/__tests__/primitives.test.tsx \
  src/renderer/pages/history/__tests__/historyRecordsHelpers.test.tsx \
  src/renderer/components/resourceCatalog/catalog/__tests__/ResourceGrid.test.tsx \
  src/renderer/components/resourceCatalog/selectors/__tests__/ResourceSelectorShell.test.tsx \
  src/renderer/components/__tests__/EmojiIcon.test.tsx
```

Expected: all selected tests PASS with zero failures.

- [ ] **Step 2: Run repository-required verification**

Run in this order because formatting and lint commands write files:

```bash
pnpm format
pnpm lint
pnpm test
pnpm build:check
```

Expected: every command exits 0. If formatting changes files, inspect them and rerun focused tests before continuing.

- [ ] **Step 3: Inspect final diff and package isolation**

```bash
git diff --check origin/main...HEAD
git status --short
if rg -n "fluent-emoji-data|codepointToIconName" packages/ui/dist/index.* packages/ui/dist/components/index.*; then
  exit 1
fi
```

Expected: no whitespace errors; only intentional files are changed; the final `rg` returns no matches for root/components build entries. Pushing and resolving GitHub review threads remain separate user-authorized actions.
