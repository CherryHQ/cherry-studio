import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import { ImportService } from '@renderer/services/import/ImportService'
import type { ImportResponse } from '@renderer/services/import/types'

import { buildChatGPTExportScript, type ChatGPTExportResult } from './scripts/chatgpt-export'
import { buildGeminiExportScript, type GeminiExportResult } from './scripts/gemini-export'

const logger = loggerService.withContext('MinAppExportService')

export type SupportedMinApp = (typeof MinAppExportService.SUPPORTED_APPS)[number]

export interface ExportPayload {
  appId: SupportedMinApp
  conversations: any[]
  count: number
}

class MinAppExportService {
  static SUPPORTED_APPS = ['openai', 'gemini'] as const

  /** 判断是否支持导出 */
  static isExportSupported(appId: string): appId is SupportedMinApp {
    return MinAppExportService.SUPPORTED_APPS.includes(appId as SupportedMinApp)
  }

  /** 导出当前小程序会话 */
  async exportConversations(webviewId: number, appId: string): Promise<ExportPayload> {
    if (!MinAppExportService.isExportSupported(appId)) {
      throw new Error(i18n.t('minapp.export.error', { defaultValue: 'Unsupported app', error: appId }))
    }

    if (Number.isNaN(webviewId) || webviewId === undefined || webviewId === null) {
      throw new Error(i18n.t('minapp.export.error', { defaultValue: 'WebView not ready', error: 'webviewId' }))
    }

    const api = window.api?.webview
    if (!api?.executeScript) {
      throw new Error(
        i18n.t('minapp.export.error', { defaultValue: 'WebView API unavailable', error: 'executeScript' })
      )
    }

    const script = this.getScript(appId)
    const rawResult = await api.executeScript(webviewId, script)
    if (rawResult && typeof rawResult === 'object' && 'error' in rawResult && rawResult.error) {
      throw new Error(String((rawResult as any).error))
    }
    const conversations = this.normalizeConversations(rawResult)

    if (conversations.length === 0) {
      throw new Error(
        i18n.t('minapp.export.no_conversations', { defaultValue: 'No conversations found in current app' })
      )
    }

    logger.info(`Exported ${conversations.length} conversations from ${appId}`)
    return { appId, conversations, count: conversations.length }
  }

  /** 将导出结果导入到应用，复用 ImportService */
  async importToApp(payload: ExportPayload, appId?: SupportedMinApp): Promise<ImportResponse> {
    const targetApp = MinAppExportService.isExportSupported(appId || payload.appId)
      ? appId || payload.appId
      : payload.appId

    const importerName = this.getImporterName(targetApp)
    const fileContent = JSON.stringify(payload.conversations)

    return await ImportService.importConversations(fileContent, importerName)
  }

  /** 根据小程序类型选择脚本 */
  private getScript(appId: SupportedMinApp): string {
    if (appId === 'openai') return buildChatGPTExportScript()
    return buildGeminiExportScript()
  }

  /** 将脚本返回值转换为统一数组结构 */
  private normalizeConversations(result: ChatGPTExportResult | GeminiExportResult | any): any[] {
    if (result && Array.isArray((result as ChatGPTExportResult).conversations)) {
      return (result as ChatGPTExportResult).conversations
    }

    if (Array.isArray(result)) {
      return result
    }

    return []
  }

  /** 对应 ImportService 的导入器名称 */
  private getImporterName(appId: SupportedMinApp): string {
    if (appId === 'openai') return 'chatgpt'
    if (appId === 'gemini') return 'gemini'
    return appId
  }
}

export const minAppExportService = new MinAppExportService()

export { MinAppExportService }
