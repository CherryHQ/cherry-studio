import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow, ipcMain } from 'electron'

import * as MsTTSService from './MsTTSService'

/**
 * 注册MsTTS相关的IPC处理程序
 */
export function registerMsTTSIpcHandlers(): void {
  // 获取可用的语音列表
  ipcMain.handle(IpcChannel.MsTTS_GetVoices, MsTTSService.getVoices)

  // 合成语音
  ipcMain.handle(IpcChannel.MsTTS_Synthesize, (_, text: string, voice: string, outputFormat: string) =>
    MsTTSService.synthesize(text, voice, outputFormat)
  )

  // 流式合成语音
  ipcMain.handle(
    IpcChannel.MsTTS_SynthesizeStream,
    async (event, requestId: string, text: string, voice: string, outputFormat: string) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return

      try {
        await MsTTSService.synthesizeStream(
          text,
          voice,
          outputFormat,
          (chunk: Uint8Array) => {
            // 发送音频数据块
            if (!window.isDestroyed()) {
              window.webContents.send(IpcChannel.MsTTS_StreamData, requestId, chunk)
            }
          },
          () => {
            // 发送流结束信号
            if (!window.isDestroyed()) {
              window.webContents.send(IpcChannel.MsTTS_StreamEnd, requestId)
            }
          }
        )
        return { success: true }
      } catch (error) {
        console.error('流式TTS合成失败:', error)
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )
}
