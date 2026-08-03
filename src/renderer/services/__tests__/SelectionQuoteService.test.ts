import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { describe, expect, it, vi } from 'vitest'

import { findSelectionQuoteTargetTab, routeSelectionQuoteToChat, selectionQuoteService } from '../SelectionQuoteService'

function tab(id: string, url: string, lastAccessTime: number): Tab {
  return { id, url, lastAccessTime, type: 'route', isDormant: false, title: id }
}

describe('SelectionQuoteService', () => {
  it('keeps the active usable chat tab', () => {
    const activeChat = tab('active-chat', '/app/chat?topicId=active', 1)
    const newerChat = tab('newer-chat', '/app/chat?topicId=newer', 2)

    expect(findSelectionQuoteTargetTab([activeChat, newerChat], activeChat)).toBe(activeChat)
  })

  it('selects the most recently used chat tab when another page is active', () => {
    const settings = tab('settings', '/settings/general', 3)
    const olderChat = tab('older-chat', '/app/chat?topicId=older', 1)
    const newerChat = tab('newer-chat', '/app/chat?topicId=newer', 2)

    expect(findSelectionQuoteTargetTab([settings, olderChat, newerChat], settings)).toBe(newerChat)
  })

  it('requires a new chat when only non-composer pages exist', () => {
    const settings = tab('settings', '/settings/general', 2)
    const messageView = tab('message-view', '/app/chat?topicId=topic&view=message', 1)

    expect(findSelectionQuoteTargetTab([settings, messageView], settings)).toBeUndefined()
  })

  it('keeps a request pending until its matching acknowledgement', () => {
    selectionQuoteService.store('delivery-chat', { id: 'delivery-request-1', text: 'Selected text' })

    expect(selectionQuoteService.peek('delivery-chat', 'delivery-request-1')).toEqual({
      id: 'delivery-request-1',
      text: 'Selected text'
    })
    expect(selectionQuoteService.peek('delivery-chat', 'delivery-request-1')).toEqual({
      id: 'delivery-request-1',
      text: 'Selected text'
    })
    selectionQuoteService.ack('delivery-chat', 'delivery-request-1')
    expect(selectionQuoteService.peek('delivery-chat', 'delivery-request-1')).toBeUndefined()
  })

  it('routes to an existing chat without creating another tab', () => {
    const settings = tab('settings', '/settings/general', 3)
    const chat = tab('chat', '/app/chat?topicId=topic-1', 2)
    const openTab = vi.fn(() => 'new-tab')
    const setActiveTab = vi.fn()
    const updateTab = vi.fn()

    routeSelectionQuoteToChat({
      activeTab: settings,
      openTab,
      request: { id: 'existing-request-1', text: 'Selected text' },
      setActiveTab,
      tabs: [settings, chat],
      updateTab
    })

    expect(openTab).not.toHaveBeenCalled()
    expect(updateTab).toHaveBeenCalledWith('chat', {
      url: '/app/chat?topicId=topic-1&quoteRequestId=existing-request-1'
    })
    expect(setActiveTab).toHaveBeenCalledWith('chat')
    selectionQuoteService.ack('chat', 'existing-request-1')
  })

  it('opens a new chat only when no usable chat tab exists', () => {
    const settings = tab('settings', '/settings/general', 3)
    const openTab = vi.fn(() => 'new-tab')
    const setActiveTab = vi.fn()
    const updateTab = vi.fn()

    routeSelectionQuoteToChat({
      activeTab: settings,
      openTab,
      request: { id: 'new-request-1', text: 'Selected text' },
      setActiveTab,
      tabs: [settings],
      updateTab
    })

    expect(openTab).toHaveBeenCalledWith('/app/chat?quoteRequestId=new-request-1', { forceNew: true })
    expect(updateTab).not.toHaveBeenCalled()
    expect(setActiveTab).not.toHaveBeenCalled()

    expect(selectionQuoteService.peek('new-tab', 'new-request-1')).toEqual({
      id: 'new-request-1',
      text: 'Selected text'
    })
    selectionQuoteService.ack('new-tab', 'new-request-1')
  })

  it('bounds rapid quotes to the target tab single pending slot', () => {
    const chat = tab('replacement-chat', '/app/chat?topicId=topic-1', 2)
    const openTab = vi.fn(() => 'unused-tab')
    const setActiveTab = vi.fn()
    const updateTab = vi.fn()

    routeSelectionQuoteToChat({
      activeTab: chat,
      openTab,
      request: { id: 'replacement-request-1', text: 'First selection' },
      setActiveTab,
      tabs: [chat],
      updateTab
    })
    routeSelectionQuoteToChat({
      activeTab: chat,
      openTab,
      request: { id: 'replacement-request-2', text: 'Second selection' },
      setActiveTab,
      tabs: [chat],
      updateTab
    })

    expect(updateTab).toHaveBeenCalledTimes(2)
    expect(selectionQuoteService.peek('replacement-chat', 'replacement-request-1')).toBeUndefined()
    expect(selectionQuoteService.peek('replacement-chat', 'replacement-request-2')).toEqual({
      id: 'replacement-request-2',
      text: 'Second selection'
    })
    selectionQuoteService.ack('replacement-chat', 'replacement-request-1')
    expect(selectionQuoteService.getCurrentRequestId('replacement-chat')).toBe('replacement-request-2')
    selectionQuoteService.ack('replacement-chat', 'replacement-request-2')
  })

  it('reuses the reserved tab while a newly opened chat has not entered tab state', () => {
    const settings = tab('reserved-settings', '/settings/general', 3)
    const openTab = vi.fn(() => 'reserved-chat')
    const setActiveTab = vi.fn()
    const updateTab = vi.fn()

    routeSelectionQuoteToChat({
      activeTab: settings,
      openTab,
      request: { id: 'reserved-request-1', text: 'First selection' },
      setActiveTab,
      tabs: [settings],
      updateTab
    })
    routeSelectionQuoteToChat({
      activeTab: settings,
      openTab,
      request: { id: 'reserved-request-2', text: 'Second selection' },
      setActiveTab,
      tabs: [settings],
      updateTab
    })

    expect(openTab).toHaveBeenCalledOnce()
    expect(selectionQuoteService.peek('reserved-chat', 'reserved-request-1')).toBeUndefined()
    expect(selectionQuoteService.peek('reserved-chat', 'reserved-request-2')).toEqual({
      id: 'reserved-request-2',
      text: 'Second selection'
    })
    selectionQuoteService.ack('reserved-chat', 'reserved-request-2')
  })

  it('opens a new chat after the reserved target was mounted and closed before insertion', () => {
    const settings = tab('closed-settings', '/settings/general', 3)
    const closedChat = tab('closed-chat', '/app/chat?quoteRequestId=closed-request-1', 4)
    const openTab = vi.fn().mockReturnValueOnce('closed-chat').mockReturnValueOnce('replacement-chat')
    const setActiveTab = vi.fn()
    const updateTab = vi.fn()

    routeSelectionQuoteToChat({
      activeTab: settings,
      openTab,
      request: { id: 'closed-request-1', text: 'First selection' },
      setActiveTab,
      tabs: [settings],
      updateTab
    })
    selectionQuoteService.reconcileTabs([settings, closedChat])
    selectionQuoteService.reconcileTabs([settings])

    routeSelectionQuoteToChat({
      activeTab: settings,
      openTab,
      request: { id: 'replacement-request-1', text: 'Second selection' },
      setActiveTab,
      tabs: [settings],
      updateTab
    })

    expect(openTab).toHaveBeenCalledTimes(2)
    expect(selectionQuoteService.peek('closed-chat', 'closed-request-1')).toBeUndefined()
    expect(selectionQuoteService.peek('replacement-chat', 'replacement-request-1')).toEqual({
      id: 'replacement-request-1',
      text: 'Second selection'
    })
    selectionQuoteService.ack('replacement-chat', 'replacement-request-1')
  })
})
