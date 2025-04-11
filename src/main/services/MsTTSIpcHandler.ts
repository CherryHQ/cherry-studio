import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

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
}
