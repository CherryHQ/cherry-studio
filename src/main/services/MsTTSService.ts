import fs from 'node:fs'
import path from 'node:path'

import { MsEdgeTTS, OUTPUT_FORMAT } from 'edge-tts-node' // 新版支持流式的TTS库
import { app } from 'electron'
import log from 'electron-log'
import { EdgeTTS } from 'node-edge-tts' // 旧版TTS库

// --- START OF HARDCODED VOICE LIST ---
// WARNING: This list is static and may become outdated.
// It's generally recommended to use listVoices() for the most up-to-date list.
const hardcodedVoices = [
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (af-ZA, AdriNeural)',
    ShortName: 'af-ZA-AdriNeural',
    Gender: 'Female',
    Locale: 'af-ZA'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (am-ET, MekdesNeural)',
    ShortName: 'am-ET-MekdesNeural',
    Gender: 'Female',
    Locale: 'am-ET'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (ar-AE, FatimaNeural)',
    ShortName: 'ar-AE-FatimaNeural',
    Gender: 'Female',
    Locale: 'ar-AE'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (ar-AE, HamdanNeural)',
    ShortName: 'ar-AE-HamdanNeural',
    Gender: 'Male',
    Locale: 'ar-AE'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (ar-BH, AliNeural)',
    ShortName: 'ar-BH-AliNeural',
    Gender: 'Male',
    Locale: 'ar-BH'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (ar-BH, LailaNeural)',
    ShortName: 'ar-BH-LailaNeural',
    Gender: 'Female',
    Locale: 'ar-BH'
  },
  // ... (Many other Arabic locales/voices) ...
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (ar-SA, ZariyahNeural)',
    ShortName: 'ar-SA-ZariyahNeural',
    Gender: 'Female',
    Locale: 'ar-SA'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (az-AZ, BabekNeural)',
    ShortName: 'az-AZ-BabekNeural',
    Gender: 'Male',
    Locale: 'az-AZ'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (az-AZ, BanuNeural)',
    ShortName: 'az-AZ-BanuNeural',
    Gender: 'Female',
    Locale: 'az-AZ'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (bg-BG, BorislavNeural)',
    ShortName: 'bg-BG-BorislavNeural',
    Gender: 'Male',
    Locale: 'bg-BG'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (bg-BG, KalinaNeural)',
    ShortName: 'bg-BG-KalinaNeural',
    Gender: 'Female',
    Locale: 'bg-BG'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (bn-BD, NabanitaNeural)',
    ShortName: 'bn-BD-NabanitaNeural',
    Gender: 'Female',
    Locale: 'bn-BD'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (bn-BD, PradeepNeural)',
    ShortName: 'bn-BD-PradeepNeural',
    Gender: 'Male',
    Locale: 'bn-BD'
  },
  // ... (Catalan, Czech, Welsh, Danish, German, Greek, English variants) ...
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-AU, NatashaNeural)',
    ShortName: 'en-AU-NatashaNeural',
    Gender: 'Female',
    Locale: 'en-AU'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-AU, WilliamNeural)',
    ShortName: 'en-AU-WilliamNeural',
    Gender: 'Male',
    Locale: 'en-AU'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-CA, ClaraNeural)',
    ShortName: 'en-CA-ClaraNeural',
    Gender: 'Female',
    Locale: 'en-CA'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-CA, LiamNeural)',
    ShortName: 'en-CA-LiamNeural',
    Gender: 'Male',
    Locale: 'en-CA'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-GB, LibbyNeural)',
    ShortName: 'en-GB-LibbyNeural',
    Gender: 'Female',
    Locale: 'en-GB'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-GB, MaisieNeural)',
    ShortName: 'en-GB-MaisieNeural',
    Gender: 'Female',
    Locale: 'en-GB'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-GB, RyanNeural)',
    ShortName: 'en-GB-RyanNeural',
    Gender: 'Male',
    Locale: 'en-GB'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-GB, SoniaNeural)',
    ShortName: 'en-GB-SoniaNeural',
    Gender: 'Female',
    Locale: 'en-GB'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-GB, ThomasNeural)',
    ShortName: 'en-GB-ThomasNeural',
    Gender: 'Male',
    Locale: 'en-GB'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-HK, SamNeural)',
    ShortName: 'en-HK-SamNeural',
    Gender: 'Male',
    Locale: 'en-HK'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-HK, YanNeural)',
    ShortName: 'en-HK-YanNeural',
    Gender: 'Female',
    Locale: 'en-HK'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-IE, ConnorNeural)',
    ShortName: 'en-IE-ConnorNeural',
    Gender: 'Male',
    Locale: 'en-IE'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-IE, EmilyNeural)',
    ShortName: 'en-IE-EmilyNeural',
    Gender: 'Female',
    Locale: 'en-IE'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-IN, NeerjaNeural)',
    ShortName: 'en-IN-NeerjaNeural',
    Gender: 'Female',
    Locale: 'en-IN'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-IN, PrabhatNeural)',
    ShortName: 'en-IN-PrabhatNeural',
    Gender: 'Male',
    Locale: 'en-IN'
  },
  // ... (Many more English variants: KE, NG, NZ, PH, SG, TZ, US, ZA) ...
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-US, AriaNeural)',
    ShortName: 'en-US-AriaNeural',
    Gender: 'Female',
    Locale: 'en-US'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-US, AnaNeural)',
    ShortName: 'en-US-AnaNeural',
    Gender: 'Female',
    Locale: 'en-US'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-US, ChristopherNeural)',
    ShortName: 'en-US-ChristopherNeural',
    Gender: 'Male',
    Locale: 'en-US'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-US, EricNeural)',
    ShortName: 'en-US-EricNeural',
    Gender: 'Male',
    Locale: 'en-US'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-US, GuyNeural)',
    ShortName: 'en-US-GuyNeural',
    Gender: 'Male',
    Locale: 'en-US'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)',
    ShortName: 'en-US-JennyNeural',
    Gender: 'Female',
    Locale: 'en-US'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-US, MichelleNeural)',
    ShortName: 'en-US-MichelleNeural',
    Gender: 'Female',
    Locale: 'en-US'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-US, RogerNeural)',
    ShortName: 'en-US-RogerNeural',
    Gender: 'Male',
    Locale: 'en-US'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (en-US, SteffanNeural)',
    ShortName: 'en-US-SteffanNeural',
    Gender: 'Male',
    Locale: 'en-US'
  },
  // ... (Spanish variants) ...
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (es-MX, DaliaNeural)',
    ShortName: 'es-MX-DaliaNeural',
    Gender: 'Female',
    Locale: 'es-MX'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (es-MX, JorgeNeural)',
    ShortName: 'es-MX-JorgeNeural',
    Gender: 'Male',
    Locale: 'es-MX'
  },
  // ... (Estonian, Basque, Persian, Finnish, Filipino, French, Irish, Galician, Gujarati, Hebrew, Hindi, Croatian, Hungarian, Indonesian, Icelandic, Italian, Japanese) ...
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (ja-JP, KeitaNeural)',
    ShortName: 'ja-JP-KeitaNeural',
    Gender: 'Male',
    Locale: 'ja-JP'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (ja-JP, NanamiNeural)',
    ShortName: 'ja-JP-NanamiNeural',
    Gender: 'Female',
    Locale: 'ja-JP'
  },
  // ... (Javanese, Georgian, Kazakh, Khmer, Kannada, Korean) ...
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (ko-KR, InJoonNeural)',
    ShortName: 'ko-KR-InJoonNeural',
    Gender: 'Male',
    Locale: 'ko-KR'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (ko-KR, SunHiNeural)',
    ShortName: 'ko-KR-SunHiNeural',
    Gender: 'Female',
    Locale: 'ko-KR'
  },
  // ... (Lao, Lithuanian, Latvian, Macedonian, Malayalam, Mongolian, Marathi, Malay, Maltese, Burmese, Norwegian, Dutch, Polish, Pashto, Portuguese) ...
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (pt-BR, AntonioNeural)',
    ShortName: 'pt-BR-AntonioNeural',
    Gender: 'Male',
    Locale: 'pt-BR'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (pt-BR, FranciscaNeural)',
    ShortName: 'pt-BR-FranciscaNeural',
    Gender: 'Female',
    Locale: 'pt-BR'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (pt-PT, DuarteNeural)',
    ShortName: 'pt-PT-DuarteNeural',
    Gender: 'Male',
    Locale: 'pt-PT'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (pt-PT, RaquelNeural)',
    ShortName: 'pt-PT-RaquelNeural',
    Gender: 'Female',
    Locale: 'pt-PT'
  },
  // ... (Romanian, Russian, Sinhala, Slovak, Slovenian, Somali, Albanian, Serbian, Sundanese, Swedish, Swahili, Tamil, Telugu, Thai) ...
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (th-TH, NiwatNeural)',
    ShortName: 'th-TH-NiwatNeural',
    Gender: 'Male',
    Locale: 'th-TH'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (th-TH, PremwadeeNeural)',
    ShortName: 'th-TH-PremwadeeNeural',
    Gender: 'Female',
    Locale: 'th-TH'
  },
  // ... (Turkish, Ukrainian, Urdu, Uzbek, Vietnamese) ...
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (vi-VN, HoaiMyNeural)',
    ShortName: 'vi-VN-HoaiMyNeural',
    Gender: 'Female',
    Locale: 'vi-VN'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (vi-VN, NamMinhNeural)',
    ShortName: 'vi-VN-NamMinhNeural',
    Gender: 'Male',
    Locale: 'vi-VN'
  },
  // ... (Chinese variants) ...
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)',
    ShortName: 'zh-CN-XiaoxiaoNeural',
    Gender: 'Female',
    Locale: 'zh-CN'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (zh-CN, YunxiNeural)',
    ShortName: 'zh-CN-YunxiNeural',
    Gender: 'Male',
    Locale: 'zh-CN'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (zh-CN, YunjianNeural)',
    ShortName: 'zh-CN-YunjianNeural',
    Gender: 'Male',
    Locale: 'zh-CN'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (zh-CN, YunxiaNeural)',
    ShortName: 'zh-CN-YunxiaNeural',
    Gender: 'Male',
    Locale: 'zh-CN'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (zh-CN, YunyangNeural)',
    ShortName: 'zh-CN-YunyangNeural',
    Gender: 'Male',
    Locale: 'zh-CN'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (zh-CN-liaoning, XiaobeiNeural)',
    ShortName: 'zh-CN-liaoning-XiaobeiNeural',
    Gender: 'Female',
    Locale: 'zh-CN-liaoning'
  },
  // { Name: 'Microsoft Server Speech Text to Speech Voice (zh-CN-shaanxi, XiaoniNeural)', ShortName: 'zh-CN-shaanxi-XiaoniNeural', Gender: 'Female', Locale: 'zh-CN-shaanxi' }, // Example regional voice
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (zh-HK, HiuGaaiNeural)',
    ShortName: 'zh-HK-HiuGaaiNeural',
    Gender: 'Female',
    Locale: 'zh-HK'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (zh-HK, HiuMaanNeural)',
    ShortName: 'zh-HK-HiuMaanNeural',
    Gender: 'Female',
    Locale: 'zh-HK'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (zh-HK, WanLungNeural)',
    ShortName: 'zh-HK-WanLungNeural',
    Gender: 'Male',
    Locale: 'zh-HK'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (zh-TW, HsiaoChenNeural)',
    ShortName: 'zh-TW-HsiaoChenNeural',
    Gender: 'Female',
    Locale: 'zh-TW'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (zh-TW, HsiaoYuNeural)',
    ShortName: 'zh-TW-HsiaoYuNeural',
    Gender: 'Female',
    Locale: 'zh-TW'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (zh-TW, YunJheNeural)',
    ShortName: 'zh-TW-YunJheNeural',
    Gender: 'Male',
    Locale: 'zh-TW'
  },
  // ... (Zulu) ...
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (zu-ZA, ThandoNeural)',
    ShortName: 'zu-ZA-ThandoNeural',
    Gender: 'Female',
    Locale: 'zu-ZA'
  },
  {
    Name: 'Microsoft Server Speech Text to Speech Voice (zu-ZA, ThembaNeural)',
    ShortName: 'zu-ZA-ThembaNeural',
    Gender: 'Male',
    Locale: 'zu-ZA'
  }
]
// --- END OF HARDCODED VOICE LIST ---

/**
 * 免费在线TTS服务
 * 使用免费的在线TTS服务，不需要API密钥
 */
class MsTTSService {
  private static instance: MsTTSService
  private tempDir: string

  private constructor() {
    this.tempDir = path.join(app.getPath('temp'), 'cherry-tts')
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true })
    }
    log.info('初始化免费在线TTS服务 (使用硬编码语音列表)')
  }

  public static getInstance(): MsTTSService {
    if (!MsTTSService.instance) {
      MsTTSService.instance = new MsTTSService()
    }
    return MsTTSService.instance
  }

  /**
   * 流式合成语音
   * @param text 要合成的文本
   * @param voice 语音的 ShortName (例如 'zh-CN-XiaoxiaoNeural')
   * @param outputFormat 输出格式 (例如 'audio-24khz-48kbitrate-mono-mp3')
   * @param onData 数据块回调
   * @param onEnd 结束回调
   */
  public async synthesizeStream(
    text: string,
    voice: string,
    outputFormat: string,
    onData: (chunk: Uint8Array) => void,
    onEnd: () => void
  ): Promise<void> {
    try {
      // 记录详细的请求信息
      log.info(`流式微软在线TTS合成语音: 文本="${text.substring(0, 30)}...", 语音=${voice}, 格式=${outputFormat}`)

      // 验证输入参数
      if (!text || text.trim() === '') {
        throw new Error('要合成的文本不能为空')
      }

      if (!voice || voice.trim() === '') {
        throw new Error('语音名称不能为空')
      }

      // 创建一个新的MsEdgeTTS实例
      const tts = new MsEdgeTTS({
        enableLogger: false // 禁用内部日志
      })

      // 设置元数据
      let msOutputFormat: OUTPUT_FORMAT
      if (outputFormat.includes('mp3')) {
        msOutputFormat = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
      } else if (outputFormat.includes('webm')) {
        msOutputFormat = OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS
      } else {
        msOutputFormat = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
      }

      await tts.setMetadata(voice, msOutputFormat)

      // 创建流
      const audioStream = tts.toStream(text)

      // 监听数据事件
      audioStream.on('data', (data: Buffer) => {
        onData(data)
      })

      // 监听结束事件
      audioStream.on('end', () => {
        log.info(`流式微软在线TTS合成成功`)
        onEnd()
      })

      // 监听错误事件
      audioStream.on('error', (error: Error) => {
        log.error(`流式微软在线TTS语音合成失败:`, error)
        throw error
      })
    } catch (error: any) {
      // 记录详细的错误信息
      log.error(`流式微软在线TTS语音合成失败 (语音=${voice}):`, error)
      throw error
    }
  }

  /**
   * 获取可用的语音列表 (返回硬编码列表)
   * @returns 语音列表
   */
  public async getVoices(): Promise<any[]> {
    try {
      log.info(`返回硬编码的 ${hardcodedVoices.length} 个语音列表`)
      // 直接返回硬编码的列表
      // 注意：保持 async 是为了接口兼容性，虽然这里没有实际的异步操作
      return hardcodedVoices
    } catch (error) {
      // 这个 try/catch 在这里意义不大了，因为返回静态数据不会出错
      // 但保留结构以防未来改动
      log.error('获取硬编码语音列表时出错 (理论上不应发生):', error)
      return [] // 返回空列表以防万一
    }
  }

  /**
   * 合成语音
   * @param text 要合成的文本
   * @param voice 语音的 ShortName (例如 'zh-CN-XiaoxiaoNeural')
   * @param outputFormat 输出格式 (例如 'audio-24khz-48kbitrate-mono-mp3')
   * @returns 音频文件路径
   */
  public async synthesize(text: string, voice: string, outputFormat: string): Promise<string> {
    try {
      // 记录详细的请求信息
      log.info(`微软在线TTS合成语音: 文本="${text.substring(0, 30)}...", 语音=${voice}, 格式=${outputFormat}`)

      // 验证输入参数
      if (!text || text.trim() === '') {
        throw new Error('要合成的文本不能为空')
      }

      if (!voice || voice.trim() === '') {
        throw new Error('语音名称不能为空')
      }

      // 创建一个新的EdgeTTS实例，并设置参数
      // 添加超时设置，默认为30秒
      const tts = new EdgeTTS({
        voice: voice,
        outputFormat: outputFormat,
        timeout: 30000, // 30秒超时
        rate: '+0%', // 正常语速
        pitch: '+0Hz', // 正常音调
        volume: '+0%' // 正常音量
      })

      // 生成临时文件路径
      const timestamp = Date.now()
      const fileExtension = outputFormat.includes('mp3') ? 'mp3' : outputFormat.split('-').pop() || 'audio'
      const outputPath = path.join(this.tempDir, `tts_${timestamp}.${fileExtension}`)

      log.info(`开始生成语音文件: ${outputPath}`)

      // 使用ttsPromise方法生成文件
      await tts.ttsPromise(text, outputPath)

      // 验证生成的文件是否存在且大小大于0
      if (!fs.existsSync(outputPath)) {
        throw new Error(`生成的语音文件不存在: ${outputPath}`)
      }

      const stats = fs.statSync(outputPath)
      if (stats.size === 0) {
        throw new Error(`生成的语音文件大小为0: ${outputPath}`)
      }

      log.info(`微软在线TTS合成成功: ${outputPath}, 文件大小: ${stats.size} 字节`)
      return outputPath
    } catch (error: any) {
      // 记录详细的错误信息
      log.error(`微软在线TTS语音合成失败 (语音=${voice}):`, error)

      // 尝试提供更有用的错误信息
      if (error.message && typeof error.message === 'string') {
        if (error.message.includes('Timed out')) {
          throw new Error(`语音合成超时，请检查网络连接或尝试其他语音`)
        } else if (error.message.includes('ENOTFOUND')) {
          throw new Error(`无法连接到微软语音服务，请检查网络连接`)
        } else if (error.message.includes('ECONNREFUSED')) {
          throw new Error(`连接被拒绝，请检查网络设置或代理配置`)
        }
      }

      throw error
    }
  }

  /**
   * (可选) 清理临时文件目录
   */
  public async cleanupTempDir(): Promise<void> {
    // (Cleanup method remains the same)
    try {
      const files = await fs.promises.readdir(this.tempDir)
      for (const file of files) {
        if (file.startsWith('tts_')) {
          await fs.promises.unlink(path.join(this.tempDir, file))
        }
      }
      log.info('TTS 临时文件已清理')
    } catch (error) {
      log.error('清理 TTS 临时文件失败:', error)
    }
  }
}

// 导出单例方法 (保持不变)
export const getVoices = async () => {
  return await MsTTSService.getInstance().getVoices()
}

export const synthesize = async (text: string, voice: string, outputFormat: string) => {
  return await MsTTSService.getInstance().synthesize(text, voice, outputFormat)
}

export const synthesizeStream = async (
  text: string,
  voice: string,
  outputFormat: string,
  onData: (chunk: Uint8Array) => void,
  onEnd: () => void
) => {
  return await MsTTSService.getInstance().synthesizeStream(text, voice, outputFormat, onData, onEnd)
}

export const cleanupTtsTempFiles = async () => {
  await MsTTSService.getInstance().cleanupTempDir()
}
