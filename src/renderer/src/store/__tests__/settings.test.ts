import { describe, expect, it } from 'vitest'

import { settingsSlice, initialState } from '../settings'

describe('settingsSlice', () => {
  it('should return the initial state', () => {
    expect(settingsSlice.getInitialState()).toEqual(initialState)
  })

  it('should handle setShowAssistants', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setShowAssistants(false))
    expect(state.showAssistants).toBe(false)
  })

  it('should handle setShowTopics', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setShowTopics(false))
    expect(state.showTopics).toBe(false)
  })

  it('should handle setSendMessageShortcut', () => {
    const state = settingsSlice.reducer(
      initialState,
      settingsSlice.actions.setSendMessageShortcut('Shift+Enter')
    )
    expect(state.sendMessageShortcut).toBe('Shift+Enter')
  })

  it('should handle setLanguage', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setLanguage('zh-CN'))
    expect(state.language).toBe('zh-CN')
  })

  it('should handle setTargetLanguage', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setTargetLanguage('en-US'))
    expect(state.targetLanguage).toBe('en-US')
  })

  it('should handle setProxyMode', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setProxyMode('custom'))
    expect(state.proxyMode).toBe('custom')
  })

  it('should handle setProxyUrl', () => {
    const state = settingsSlice.reducer(
      initialState,
      settingsSlice.actions.setProxyUrl('http://localhost:8080')
    )
    expect(state.proxyUrl).toBe('http://localhost:8080')
  })

  it('should handle setUserName', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setUserName('Test User'))
    expect(state.userName).toBe('Test User')
  })

  it('should handle setShowPrompt', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setShowPrompt(true))
    expect(state.showPrompt).toBe(true)
  })

  it('should handle setShowMessageDivider', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setShowMessageDivider(false))
    expect(state.showMessageDivider).toBe(false)
  })

  it('should handle setMessageFont', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setMessageFont('serif'))
    expect(state.messageFont).toBe('serif')
  })

  it('should handle setShowInputEstimatedTokens', () => {
    const state = settingsSlice.reducer(
      initialState,
      settingsSlice.actions.setShowInputEstimatedTokens(true)
    )
    expect(state.showInputEstimatedTokens).toBe(true)
  })

  it('should handle setLaunchOnBoot', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setLaunchOnBoot(true))
    expect(state.launchOnBoot).toBe(true)
  })

  it('should handle setLaunchToTray', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setLaunchToTray(true))
    expect(state.launchToTray).toBe(true)
  })

  it('should handle setTrayOnClose', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setTrayOnClose(true))
    expect(state.trayOnClose).toBe(true)
  })

  it('should handle setTray', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setTray(true))
    expect(state.tray).toBe(true)
  })

  it('should handle setDefaultModel', () => {
    const model = { id: 'test-model', name: 'Test Model', provider: 'test' }
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setDefaultModel(model))
    expect(state.defaultModel).toEqual(model)
  })

  it('should handle setTheme', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setTheme('dark'))
    expect(state.theme).toBe('dark')
  })

  it('should handle setFontSize', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setFontSize(16))
    expect(state.fontSize).toBe(16)
  })

  it('should handle setCodeShowLineNumbers', () => {
    const state = settingsSlice.reducer(
      initialState,
      settingsSlice.actions.setCodeShowLineNumbers(true)
    )
    expect(state.codeShowLineNumbers).toBe(true)
  })

  it('should handle setCodeCollapsible', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setCodeCollapsible(true))
    expect(state.codeCollapsible).toBe(true)
  })

  it('should handle setCodeWrappable', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setCodeWrappable(true))
    expect(state.codeWrappable).toBe(true)
  })

  it('should handle setAutoCheckUpdate', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setAutoCheckUpdate(false))
    expect(state.autoCheckUpdate).toBe(false)
  })

  it('should handle setShowBetaVersion', () => {
    const state = settingsSlice.reducer(initialState, settingsSlice.actions.setShowBetaVersion(true))
    expect(state.showBetaVersion).toBe(true)
  })

  it('should handle setDefaultPaintingProvider', () => {
    const state = settingsSlice.reducer(
      initialState,
      settingsSlice.actions.setDefaultPaintingProvider('silicon')
    )
    expect(state.defaultPaintingProvider).toBe('silicon')
  })
})
