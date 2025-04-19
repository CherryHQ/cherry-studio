import i18n from '@renderer/i18n'

import { EdgeTTSService } from './EdgeTTSService'
import { MsTTSService } from './MsTTSService'
import { OpenAITTSService } from './OpenAITTSService'
import { SiliconflowTTSService } from './SiliconflowTTSService'
import { TTSServiceInterface } from './TTSServiceInterface'

/**
 * TTS服务工厂类
 * 用于创建不同类型的TTS服务实例
 */
export class TTSServiceFactory {
  /**
   * 创建TTS服务实例
   * @param serviceType 服务类型
   * @param settings 设置
   * @returns TTS服务实例
   */
  static createService(serviceType: string, settings: any): TTSServiceInterface {
    console.log('创建TTS服务实例，类型:', serviceType)

    switch (serviceType) {
      case 'openai':
        console.log('创建OpenAI TTS服务实例')
        return new OpenAITTSService(settings.ttsApiKey, settings.ttsApiUrl, settings.ttsVoice, settings.ttsModel)

      case 'edge':
        console.log('创建Edge TTS服务实例')
        return new EdgeTTSService(settings.ttsEdgeVoice)

      case 'siliconflow':
        console.log('创建硅基流动 TTS服务实例')
        console.log('硅基流动TTS设置:', {
          apiKey: settings.ttsSiliconflowApiKey ? '已设置' : '未设置',
          apiUrl: settings.ttsSiliconflowApiUrl,
          voice: settings.ttsSiliconflowVoice,
          model: settings.ttsSiliconflowModel,
          responseFormat: settings.ttsSiliconflowResponseFormat,
          speed: settings.ttsSiliconflowSpeed
        })
        return new SiliconflowTTSService(
          settings.ttsSiliconflowApiKey,
          settings.ttsSiliconflowApiUrl,
          settings.ttsSiliconflowVoice,
          settings.ttsSiliconflowModel,
          settings.ttsSiliconflowResponseFormat,
          settings.ttsSiliconflowSpeed
        )

      case 'mstts': {
        console.log('创建免费在线TTS服务实例')
        // 确保音色有默认值
        const msVoice = settings.ttsMsVoice || 'zh-CN-XiaoxiaoNeural'
        const msOutputFormat = settings.ttsMsOutputFormat || 'audio-24khz-48kbitrate-mono-mp3'
        console.log('免费在线TTS设置:', {
          voice: msVoice,
          outputFormat: msOutputFormat
        })
        return new MsTTSService(msVoice, msOutputFormat)
      } // Close block scope
      default:
        throw new Error(i18n.t('settings.tts.error.unsupported_service_type', { serviceType }))
    }
  }
}
