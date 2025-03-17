import { debounce, getResourcePath } from '@main/utils'
import { exec } from 'child_process'
import { screen } from 'electron'
import path from 'path'

import { windowService } from './WindowService'

export default class ClipboardMonitor {
  private platform: string
  private lastText: string
  private user32: any
  private observer: any
  public onTextSelected: (text: string) => void

  constructor() {
    this.platform = process.platform
    this.lastText = ''
    this.onTextSelected = debounce((text: string) => this.handleTextSelected(text), 550)

    if (this.platform === 'win32') {
      this.setupWindows()
    } else if (this.platform === 'darwin') {
      this.setupMacOS()
    }
  }

  setupMacOS() {
    // 使用 Swift 脚本来监听文本选择
    const scriptPath = path.join(getResourcePath(), 'textMonitor.swift')

    // 启动 Swift 进程来监听文本选择
    const process = exec(`swift ${scriptPath}`)

    process?.stdout?.on('data', (data: string) => {
      console.log('[ClipboardMonitor] MacOS data:', data)
      const text = data.toString().trim()
      if (text && text !== this.lastText) {
        this.lastText = text
        this.onTextSelected(text)
      }
    })

    process.on('error', (error) => {
      console.error('[ClipboardMonitor] MacOS error:', error)
    })
  }

  setupWindows() {
    // 使用 Windows API 监听文本选择事件
    const ffi = require('ffi-napi')
    const ref = require('ref-napi')

    this.user32 = new ffi.Library('user32', {
      SetWinEventHook: ['pointer', ['uint32', 'uint32', 'pointer', 'pointer', 'uint32', 'uint32', 'uint32']],
      UnhookWinEvent: ['bool', ['pointer']]
    })

    // 定义事件常量
    const EVENT_OBJECT_SELECTION = 0x8006
    const WINEVENT_OUTOFCONTEXT = 0x0000
    const WINEVENT_SKIPOWNTHREAD = 0x0001
    const WINEVENT_SKIPOWNPROCESS = 0x0002

    // 创建回调函数
    const callback = ffi.Callback('void', ['pointer', 'uint32', 'pointer', 'long', 'long', 'uint32', 'uint32'], () => {
      this.getSelectedText()
    })

    // 设置事件钩子
    this.observer = this.user32.SetWinEventHook(
      EVENT_OBJECT_SELECTION,
      EVENT_OBJECT_SELECTION,
      ref.NULL,
      callback,
      0,
      0,
      WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNTHREAD | WINEVENT_SKIPOWNPROCESS
    )
  }

  getSelectedText() {
    // Get selected text
    if (this.platform === 'win32') {
      const ref = require('ref-napi')
      if (this.user32.OpenClipboard(ref.NULL)) {
        // Get clipboard content
        const text = this.user32.GetClipboardData(1) // CF_TEXT = 1
        this.user32.CloseClipboard()

        if (text && text !== this.lastText) {
          this.lastText = text
          this.onTextSelected(text)
        }
      }
    }
  }

  private handleTextSelected(text: string) {
    if (!text) return

    console.log('[ClipboardMonitor] handleTextSelected', text)

    windowService.setLastSelectedText(text)

    const mousePosition = screen.getCursorScreenPoint()

    windowService.showSelectionMenu({
      x: mousePosition.x,
      y: mousePosition.y + 10
    })
  }

  dispose() {
    if (this.platform === 'win32' && this.observer) {
      this.user32.UnhookWinEvent(this.observer)
    }
  }
}
