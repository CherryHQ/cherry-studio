import type { QuickPanelContextType, QuickPanelListItem, QuickPanelOpenOptions } from '@renderer/components/QuickPanel'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerToolLauncher } from '../../toolLauncher'
import { createUnifiedQuickPanelOpenOptions, hasUnifiedQuickPanelRootContent } from '../unifiedPanel'

const quickPanel = {
  open: vi.fn(),
  close: vi.fn(),
  updateItemSelection: vi.fn(),
  updateList: vi.fn(),
  isVisible: false,
  symbol: '',
  list: [],
  defaultIndex: 0,
  pageSize: 7,
  multiple: false,
  fillToAvailableHeight: false,
  setFillToAvailableHeight: vi.fn(),
  dispatchKeyDown: vi.fn(() => false),
  getPanelGeneration: vi.fn(() => 0),
  registerKeyDownHandler: vi.fn(() => () => undefined)
} satisfies QuickPanelContextType

const labels = (items: QuickPanelListItem[]) => items.map((item) => item.label)

const getVisibleItems = (options: QuickPanelOpenOptions, searchText: string) => {
  const fuzzyRegex = new RegExp(
    searchText
      .toLowerCase()
      .split('')
      .map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*'),
    'ig'
  )
  const pinyinCache = new WeakMap<QuickPanelListItem, string>()
  const filteredItems = options.list.filter((item) => options.filterFn!(item, searchText, fuzzyRegex, pinyinCache))
  return options.sortFn!(filteredItems, searchText)
}

beforeEach(() => {
  quickPanel.open.mockReset()
  quickPanel.close.mockReset()
  quickPanel.updateItemSelection.mockReset()
  quickPanel.updateList.mockReset()
  quickPanel.setFillToAvailableHeight.mockReset()
  quickPanel.dispatchKeyDown.mockReset()
  quickPanel.dispatchKeyDown.mockReturnValue(false)
  quickPanel.getPanelGeneration.mockReset()
  quickPanel.getPanelGeneration.mockReturnValue(0)
  quickPanel.registerKeyDownHandler.mockReset()
  quickPanel.registerKeyDownHandler.mockReturnValue(() => undefined)
})

describe('createUnifiedQuickPanelOpenOptions', () => {
  it('keeps system actions above resource results while preserving business order during search', () => {
    const options = createUnifiedQuickPanelOpenOptions(
      [
        {
          id: 'attachment',
          kind: 'command',
          label: 'Attachment',
          description: 'notes',
          icon: 'paperclip',
          sources: ['popover']
        },
        {
          id: 'slash-command',
          kind: 'command',
          label: 'Slash command',
          description: 'notes',
          icon: 'slash',
          sources: ['root-panel']
        }
      ],
      {
        quickPanel,
        leadingItems: [{ id: 'new-topic', label: 'New topic', filterText: 'notes', icon: 'plus' }],
        additionalItems: [{ id: 'agent-skill', label: 'Agent skill', filterText: 'notes', icon: 'skill' }],
        resourceItems: [{ id: 'file:notes', label: 'notes.md', description: '/workspace/notes.md', icon: 'file' }]
      }
    )

    expect(options.sortFn).toEqual(expect.any(Function))

    const reversedItems = [...options.list].reverse()
    expect(labels(options.sortFn!(reversedItems, 'notes'))).toEqual([
      'New topic',
      'Attachment',
      'Slash command',
      'Agent skill',
      'notes.md'
    ])
  })

  it('renders skills above trailing command items', () => {
    const options = createUnifiedQuickPanelOpenOptions(
      [
        {
          id: 'agent-skills',
          kind: 'panel',
          label: 'Skills',
          icon: 'skill',
          sources: ['root-panel']
        },
        {
          id: 'mcp-status',
          kind: 'panel',
          label: 'MCP',
          icon: 'plug',
          sources: ['root-panel']
        },
        {
          id: 'slash-command',
          kind: 'command',
          label: 'Slash command',
          icon: 'slash',
          sources: ['root-panel'],
          rootPanelPlacement: 'trailing'
        }
      ],
      { quickPanel }
    )

    expect(labels(options.list)).toEqual(['Skills', 'MCP', 'Slash command'])
  })

  it('flattens actionable submenu and skill items into root search without exposing status rows', () => {
    const onToolLauncherSelect = vi.fn()
    const insertSkill = vi.fn()
    const options = createUnifiedQuickPanelOpenOptions(
      [
        {
          id: 'permission-mode',
          kind: 'group',
          label: 'Permission Mode',
          icon: 'shield',
          sources: ['popover'],
          submenu: [
            {
              id: 'permission-plan',
              kind: 'command',
              label: 'Plan mode',
              icon: 'plan',
              sources: ['popover'],
              action: vi.fn()
            },
            {
              id: 'permission-disabled',
              kind: 'command',
              label: 'Disabled mode',
              icon: 'disabled',
              sources: ['popover'],
              disabled: true,
              action: vi.fn()
            }
          ]
        },
        {
          id: 'agent-skills',
          kind: 'panel',
          label: 'Skills',
          icon: 'skill',
          sources: ['root-panel'],
          rootSearchItems: [
            { id: 'skill:pdf', label: 'pdf', icon: 'pdf', filterText: 'pdf', action: insertSkill },
            {
              id: 'agent-skills:manage',
              label: 'Manage skills',
              icon: 'settings',
              fixedToBottom: true,
              action: vi.fn()
            }
          ],
          action: vi.fn()
        },
        {
          id: 'mcp-status',
          kind: 'panel',
          label: 'MCP',
          description: 'View status',
          icon: 'plug',
          sources: ['root-panel'],
          action: vi.fn()
        }
      ],
      { quickPanel, onToolLauncherSelect }
    )

    expect(labels(getVisibleItems(options, ''))).toEqual(['Permission Mode', 'Skills', 'MCP'])
    expect(labels(getVisibleItems(options, 'plan'))).toEqual(['Plan mode'])
    expect(labels(getVisibleItems(options, 'pdf'))).toEqual(['pdf'])
    expect(labels(getVisibleItems(options, 'disabled'))).toEqual([])
    expect(labels(getVisibleItems(options, 'connected-server'))).toEqual([])

    const actionContext = { ...quickPanel, triggerInfo: options.triggerInfo } satisfies QuickPanelContextType
    const planMode = getVisibleItems(options, 'plan')[0]
    planMode.action?.({
      action: 'enter',
      context: actionContext,
      item: planMode,
      parentPanel: options,
      searchText: 'plan'
    })
    expect(onToolLauncherSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'permission-plan' }),
      expect.objectContaining({ source: 'popover', parentPanel: options, searchText: 'plan' })
    )

    const pdfSkill = getVisibleItems(options, 'pdf')[0]
    pdfSkill.action?.({
      action: 'enter',
      context: actionContext,
      item: pdfSkill,
      parentPanel: options,
      searchText: 'pdf'
    })
    expect(insertSkill).toHaveBeenCalledOnce()
  })

  it('excludes persistent launchers while keeping the bare-root customize footer', () => {
    const launchers = [
      {
        id: 'thinking',
        kind: 'command' as const,
        label: 'Thinking',
        icon: 'brain',
        sources: ['popover'] as const
      },
      {
        id: 'attachment',
        kind: 'command' as const,
        label: 'Attachment',
        icon: 'paperclip',
        sources: ['popover'] as const
      }
    ]
    const additionalItems = [
      {
        id: 'composer:customize-toolbar',
        label: 'Customize toolbar',
        icon: 'settings',
        fixedToBottom: true
      }
    ]

    const pinned = createUnifiedQuickPanelOpenOptions(launchers, {
      quickPanel,
      additionalItems,
      excludedLauncherIds: new Set(['thinking'])
    })
    expect(pinned.list.map((item) => item.id)).toEqual(['attachment', 'composer:customize-toolbar'])

    const unpinned = createUnifiedQuickPanelOpenOptions(launchers, { quickPanel, additionalItems })
    expect(unpinned.list.map((item) => item.id)).toEqual(['thinking', 'attachment', 'composer:customize-toolbar'])
  })

  it('drops bottom-pinned chrome from category views seeded with a search text', () => {
    const additionalItems = [
      { id: 'skill:pdf', label: 'Agent skill', filterText: 'Skills', icon: 'skill' },
      { id: 'composer:customize-toolbar', label: 'Customize toolbar', icon: 'settings', fixedToBottom: true }
    ]

    // Bare root panel keeps the fixedToBottom customize action.
    const bareRoot = createUnifiedQuickPanelOpenOptions([], { quickPanel, additionalItems })
    expect(labels(bareRoot.list)).toContain('Customize toolbar')

    // A category view (opened via a toolbar shortcut that seeds a search text) drops it so it does
    // not bypass the category filter.
    const categoryView = createUnifiedQuickPanelOpenOptions([], {
      quickPanel,
      additionalItems,
      initialSearchText: 'Skills'
    })
    expect(labels(categoryView.list)).toEqual(['Agent skill'])
  })

  it('does not reorder items when there is no search text', () => {
    const options = createUnifiedQuickPanelOpenOptions(
      [
        {
          id: 'attachment',
          kind: 'command',
          label: 'Attachment',
          icon: 'paperclip',
          sources: ['popover']
        }
      ],
      {
        quickPanel,
        resourceItems: [{ id: 'file:notes', label: 'notes.md', description: '/workspace/notes.md', icon: 'file' }]
      }
    )

    const reversedItems = [...options.list].reverse()
    expect(options.sortFn!(reversedItems, '')).toEqual(reversedItems)
  })

  it('filters by explicit text, search aliases, pinyin, and pinyin initials without loose fuzzy subsequence', () => {
    const options = createUnifiedQuickPanelOpenOptions(
      [
        {
          id: 'web-search',
          kind: 'command',
          label: '网络搜索',
          icon: 'search',
          sources: ['root-panel'],
          searchAliases: ['Web Search', 'Online Search']
        }
      ],
      {
        quickPanel,
        additionalItems: [
          {
            id: 'skill:pdf',
            label: 'pdf',
            description: 'Read and analyze PDFs',
            filterText: 'pdf',
            icon: 'skill'
          }
        ],
        resourceItems: [{ id: 'quick-phrases', label: '提示词管理', icon: 'phrase' }]
      }
    )

    const filterFn = options.filterFn!
    const fuzzyRegex = /s.*l/i
    const pinyinCache = new WeakMap<QuickPanelListItem, string>()
    const skill = options.list.find((item) => item.label === 'pdf')!
    const quickPhrases = options.list.find((item) => item.label === '提示词管理')!
    const webSearch = options.list.find((item) => item.label === '网络搜索')!

    // Skills keep their explicit root-panel search field and do not match descriptions.
    expect(filterFn(skill, 'pdf', fuzzyRegex, pinyinCache)).toBe(true)
    expect(filterFn(skill, 'analyze', fuzzyRegex, pinyinCache)).toBe(false)

    // Chinese row matches by substring, pinyin substring, and pinyin initial substring...
    expect(filterFn(quickPhrases, '提示词', fuzzyRegex, pinyinCache)).toBe(true)
    expect(filterFn(quickPhrases, 'tishi', fuzzyRegex, pinyinCache)).toBe(true)
    expect(filterFn(quickPhrases, 'tscgl', fuzzyRegex, pinyinCache)).toBe(true)

    // Launcher rows with filterText still match hidden English aliases and visible Chinese labels by initials.
    expect(filterFn(webSearch, 'web', fuzzyRegex, pinyinCache)).toBe(true)
    expect(filterFn(webSearch, 'online', fuzzyRegex, pinyinCache)).toBe(true)
    expect(filterFn(webSearch, 'wlss', fuzzyRegex, pinyinCache)).toBe(true)
    // ...but not by a loose fuzzy subsequence of its pinyin or initials.
    expect(filterFn(quickPhrases, 'sl', fuzzyRegex, pinyinCache)).toBe(false)
  })

  it('dispatches generated launcher actions with source and query context', () => {
    const onToolLauncherSelect = vi.fn()
    const inputAdapter = {
      getText: vi.fn(() => '/ask'),
      getCursorOffset: vi.fn(() => 4),
      insertText: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }
    const options = createUnifiedQuickPanelOpenOptions(
      [
        {
          id: 'attachment',
          kind: 'command',
          label: 'Attachment',
          icon: 'paperclip',
          sources: ['popover']
        },
        {
          id: 'slash-command',
          kind: 'command',
          label: 'Slash command',
          icon: 'slash',
          sources: ['root-panel']
        }
      ],
      {
        quickPanel,
        inputAdapter,
        onToolLauncherSelect,
        queryAnchor: 0,
        triggerInfo: { type: 'input', position: 0, originalText: '/ask' }
      }
    )
    const attachment = options.list.find((item) => item.label === 'Attachment')
    const slashCommand = options.list.find((item) => item.label === 'Slash command')
    const actionContext = { ...quickPanel, triggerInfo: options.triggerInfo } satisfies QuickPanelContextType

    attachment?.action?.({
      action: 'enter',
      context: actionContext,
      item: attachment,
      parentPanel: options,
      queryAnchor: 0,
      searchText: 'ask'
    })
    slashCommand?.action?.({
      action: 'enter',
      context: actionContext,
      item: slashCommand,
      parentPanel: options,
      queryAnchor: 0,
      searchText: 'ask'
    })

    expect(onToolLauncherSelect).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'attachment' }),
      expect.objectContaining({
        source: 'popover',
        inputAdapter,
        parentPanel: options,
        queryAnchor: 0,
        searchText: 'ask',
        triggerInfo: { type: 'input', position: 0, originalText: '/ask' }
      })
    )
    expect(onToolLauncherSelect).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'slash-command' }),
      expect.objectContaining({
        source: 'root-panel',
        inputAdapter,
        parentPanel: options,
        queryAnchor: 0,
        searchText: 'ask',
        triggerInfo: { type: 'input', position: 0, originalText: '/ask' }
      })
    )
  })

  it('opens submenus with parent panel context and dispatches child actions', () => {
    const onToolLauncherSelect = vi.fn()
    const options = createUnifiedQuickPanelOpenOptions(
      [
        {
          id: 'thinking',
          kind: 'group',
          label: 'Thinking',
          icon: 'brain',
          sources: ['popover'],
          submenu: [
            {
              id: 'thinking-low',
              kind: 'command',
              label: 'Low',
              icon: 'low',
              sources: ['root-panel']
            }
          ]
        }
      ],
      {
        quickPanel,
        onToolLauncherSelect,
        queryAnchor: 0,
        triggerInfo: { type: 'input', position: 0, originalText: '/think' }
      }
    )
    const thinking = options.list[0]
    const actionContext = { ...quickPanel, triggerInfo: options.triggerInfo } satisfies QuickPanelContextType

    thinking.action?.({
      action: 'enter',
      context: actionContext,
      item: thinking,
      parentPanel: options,
      queryAnchor: 0,
      searchText: 'think'
    })

    expect(quickPanel.open).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Thinking',
        symbol: 'thinking',
        parentPanel: options,
        queryAnchor: 0,
        triggerInfo: { type: 'input', position: 0, originalText: '/think' },
        list: [expect.objectContaining({ label: 'Low' })]
      })
    )

    const childPanelOptions = vi.mocked(quickPanel.open).mock.calls[0][0]
    const low = childPanelOptions.list[0]
    low.action?.({
      action: 'enter',
      context: actionContext,
      item: low,
      parentPanel: options,
      queryAnchor: 0,
      searchText: 'think'
    })

    expect(onToolLauncherSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'thinking-low' }),
      expect.objectContaining({
        source: 'root-panel',
        parentPanel: options,
        queryAnchor: 0,
        searchText: 'think',
        triggerInfo: { type: 'input', position: 0, originalText: '/think' }
      })
    )
  })

  it('ignores submenu cycles while building and opening launcher items', () => {
    const cyclicParent: ComposerToolLauncher = {
      id: 'cyclic-parent',
      kind: 'group',
      label: 'Parent',
      icon: 'parent',
      sources: ['popover'],
      submenu: []
    }
    const cyclicChild: ComposerToolLauncher = {
      id: 'cyclic-child',
      kind: 'group',
      label: 'Child',
      icon: 'child',
      sources: ['popover'],
      submenu: [cyclicParent]
    }
    cyclicParent.submenu = [cyclicChild]

    const options = createUnifiedQuickPanelOpenOptions([cyclicParent], { quickPanel })
    const actionContext = { ...quickPanel, triggerInfo: options.triggerInfo } satisfies QuickPanelContextType

    expect(options.list).toHaveLength(1)
    expect(options.list[0]).toEqual(expect.objectContaining({ label: 'Parent' }))
    expect(options.list[0].filterText).toContain('Parent')
    expect(options.list[0].filterText).not.toContain('Child')
    expect(() =>
      options.list[0].action?.({
        action: 'enter',
        context: actionContext,
        item: options.list[0],
        parentPanel: options,
        queryAnchor: 0,
        searchText: ''
      })
    ).not.toThrow()
    expect(quickPanel.open).toHaveBeenCalledWith(
      expect.objectContaining({
        list: [expect.objectContaining({ label: 'Child' })]
      })
    )
  })

  it('marks disabled launchers as disabled items with the disabled reason', () => {
    const options = createUnifiedQuickPanelOpenOptions(
      [
        {
          id: 'disabled-tool',
          kind: 'command',
          label: 'Disabled tool',
          icon: 'tool',
          disabled: true,
          disabledReason: 'Unavailable',
          sources: ['root-panel']
        }
      ],
      { quickPanel }
    )

    expect(options.list[0]).toEqual(
      expect.objectContaining({
        label: 'Disabled tool',
        description: 'Unavailable',
        disabled: true
      })
    )
  })
})

describe('hasUnifiedQuickPanelRootContent', () => {
  it('matches root item availability for visible launchers and static rows', () => {
    expect(hasUnifiedQuickPanelRootContent([])).toBe(false)
    expect(hasUnifiedQuickPanelRootContent([], { leadingItems: [{ id: 'new', label: 'New', icon: 'plus' }] })).toBe(
      true
    )
    expect(
      hasUnifiedQuickPanelRootContent([
        {
          id: 'hidden',
          kind: 'command',
          label: 'Hidden',
          icon: 'hidden',
          hidden: true,
          sources: ['root-panel']
        }
      ])
    ).toBe(false)
    expect(
      hasUnifiedQuickPanelRootContent([
        {
          id: 'group',
          kind: 'group',
          label: 'Group',
          icon: 'group',
          sources: [],
          submenu: [
            {
              id: 'child',
              kind: 'command',
              label: 'Child',
              icon: 'child',
              sources: ['root-panel']
            }
          ]
        }
      ])
    ).toBe(true)
  })
})
