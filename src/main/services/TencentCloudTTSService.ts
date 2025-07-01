import Logger from 'electron-log'
import { tts } from 'tencentcloud-sdk-nodejs-tts'
// 腾讯云 TTS SDK
const TtsClient = tts.v20190823.Client

export interface TencentCloudTTSOptions {
  secretId: string
  secretKey: string
  region?: string
  text: string
  voice?: string
  speed?: number
  volume?: number
  sampleRate?: number
  codec?: string
}

export interface TencentCloudTTSResult {
  success: boolean
  audioData?: string // Base64 编码的音频数据
  error?: string
}

export class TencentCloudTTSService {
  /**
   * 调用腾讯云 TTS API 进行语音合成
   */
  async synthesizeSpeech(options: TencentCloudTTSOptions): Promise<TencentCloudTTSResult> {
    try {
      const {
        secretId,
        secretKey,
        region = 'ap-beijing',
        text,
        voice = '101001',
        speed = 0,
        volume = 0,
        sampleRate = 16000,
        codec = 'wav'
      } = options

      if (!secretId || !secretKey) {
        return {
          success: false,
          error: 'Tencent Cloud SecretId and SecretKey are required'
        }
      }

      // 创建腾讯云客户端配置
      const clientConfig = {
        credential: {
          secretId: secretId,
          secretKey: secretKey
        },
        region: region,
        profile: {
          httpProfile: {
            endpoint: 'tts.tencentcloudapi.com'
          }
        }
      }

      // 实例化 TTS 客户端
      const client = new TtsClient(clientConfig)

      // 构建请求参数
      const params = {
        Text: text,
        SessionId: this.generateSessionId(),
        VoiceType: parseInt(voice),
        Speed: speed,
        Volume: volume,
        SampleRate: sampleRate,
        Codec: codec
      }

      Logger.info('[TencentCloudTTSService] Synthesizing speech:', {
        voiceType: params.VoiceType,
        textLength: text.length,
        speed: params.Speed,
        volume: params.Volume,
        sampleRate: params.SampleRate,
        codec: params.Codec
      })

      const response = await client.TextToVoice(params)

      if (response.Audio) {
        Logger.info('[TencentCloudTTSService] Speech synthesis successful')
        return {
          success: true,
          audioData: response.Audio
        }
      }

      Logger.error('[TencentCloudTTSService] No audio data returned')
      return {
        success: false,
        error: 'No audio data returned from Tencent Cloud TTS API'
      }
    } catch (error: any) {
      Logger.error('[TencentCloudTTSService] API Error:', error)
      return {
        success: false,
        error: `Tencent Cloud TTS API error: ${error.message || error}`
      }
    }
  }

  /**
   * 测试腾讯云 TTS API 连接
   */
  async testConnection(
    secretId: string,
    secretKey: string,
    region: string = 'ap-beijing'
  ): Promise<TencentCloudTTSResult> {
    return this.synthesizeSpeech({
      secretId,
      secretKey,
      region,
      text: 'test',
      voice: '101001'
    })
  }

  /**
   * 生成会话 ID
   */
  private generateSessionId(): string {
    return `tts-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
  }

  /**
   * 获取支持的音色列表（根据官方文档更新）
   */
  getSupportedVoices() {
    return [
      // 大模型音色（推荐）
      { id: '501000', name: '智斌 - 阅读男声', lang: 'zh-CN', gender: 'male', default: true, type: '大模型音色' },
      { id: '501001', name: '智兰 - 资讯女声', lang: 'zh-CN', gender: 'female', default: false, type: '大模型音色' },
      { id: '501002', name: '智菊 - 阅读女声', lang: 'zh-CN', gender: 'female', default: false, type: '大模型音色' },
      { id: '501003', name: '智宇 - 阅读男声', lang: 'zh-CN', gender: 'male', default: false, type: '大模型音色' },
      { id: '501004', name: '月华 - 聊天女声', lang: 'zh-CN', gender: 'female', default: false, type: '大模型音色' },
      { id: '501005', name: '飞镜 - 聊天男声', lang: 'zh-CN', gender: 'male', default: false, type: '大模型音色' },
      { id: '501008', name: 'WeJames - 外语男声', lang: 'en-US', gender: 'male', default: false, type: '大模型音色' },
      { id: '501009', name: 'WeWinny - 外语女声', lang: 'en-US', gender: 'female', default: false, type: '大模型音色' },

      // 精品音色（经典）
      { id: '101001', name: '智瑜 - 情感女声', lang: 'zh-CN', gender: 'female', default: false, type: '精品音色' },
      { id: '101002', name: '智聆 - 通用女声', lang: 'zh-CN', gender: 'female', default: false, type: '精品音色' },
      { id: '101003', name: '智美 - 客服女声', lang: 'zh-CN', gender: 'female', default: false, type: '精品音色' },
      { id: '101004', name: '智云 - 通用男声', lang: 'zh-CN', gender: 'male', default: false, type: '精品音色' },
      { id: '101005', name: '智莉 - 通用女声', lang: 'zh-CN', gender: 'female', default: false, type: '精品音色' },
      { id: '101006', name: '智言 - 助手女声', lang: 'zh-CN', gender: 'female', default: false, type: '精品音色' },
      { id: '101008', name: '智琪 - 客服女声', lang: 'zh-CN', gender: 'female', default: false, type: '精品音色' },
      { id: '101009', name: '智芸 - 知性女声', lang: 'zh-CN', gender: 'female', default: false, type: '精品音色' },
      { id: '101010', name: '智华 - 通用男声', lang: 'zh-CN', gender: 'male', default: false, type: '精品音色' },
      { id: '101011', name: '智燕 - 新闻女声', lang: 'zh-CN', gender: 'female', default: false, type: '精品音色' },
      { id: '101012', name: '智丹 - 新闻女声', lang: 'zh-CN', gender: 'female', default: false, type: '精品音色' },
      { id: '101013', name: '智辉 - 新闻男声', lang: 'zh-CN', gender: 'male', default: false, type: '精品音色' },
      { id: '101014', name: '智宁 - 新闻男声', lang: 'zh-CN', gender: 'male', default: false, type: '精品音色' },
      { id: '101015', name: '智萌 - 男童声', lang: 'zh-CN', gender: 'male', default: false, type: '精品音色' },
      { id: '101016', name: '智甜 - 女童声', lang: 'zh-CN', gender: 'female', default: false, type: '精品音色' },
      { id: '101017', name: '智蓉 - 情感女声', lang: 'zh-CN', gender: 'female', default: false, type: '精品音色' },
      { id: '101018', name: '智靖 - 情感男声', lang: 'zh-CN', gender: 'male', default: false, type: '精品音色' },
      { id: '101019', name: '智彤 - 粤语女声', lang: 'zh-HK', gender: 'female', default: false, type: '精品音色' },
      { id: '101020', name: '智刚 - 新闻男声', lang: 'zh-CN', gender: 'male', default: false, type: '精品音色' },
      { id: '101021', name: '智瑞 - 新闻男声', lang: 'zh-CN', gender: 'male', default: false, type: '精品音色' },
      { id: '101022', name: '智虹 - 新闻女声', lang: 'zh-CN', gender: 'female', default: false, type: '精品音色' },
      { id: '101050', name: 'WeJack - 英文男声', lang: 'en-US', gender: 'male', default: false, type: '精品音色' },
      { id: '101051', name: 'WeRose - 英文女声', lang: 'en-US', gender: 'female', default: false, type: '精品音色' },
      { id: '101057', name: '智美子 - 日语女声', lang: 'ja-JP', gender: 'female', default: false, type: '精品音色' },

      // 标准音色（基础）
      { id: '1001', name: '智瑜 - 情感女声', lang: 'zh-CN', gender: 'female', default: false, type: '标准音色' },
      { id: '1002', name: '智聆 - 通用女声', lang: 'zh-CN', gender: 'female', default: false, type: '标准音色' },
      { id: '1003', name: '智美 - 客服女声', lang: 'zh-CN', gender: 'female', default: false, type: '标准音色' },
      { id: '1004', name: '智云 - 通用男声', lang: 'zh-CN', gender: 'male', default: false, type: '标准音色' },
      { id: '1005', name: '智莉 - 通用女声', lang: 'zh-CN', gender: 'female', default: false, type: '标准音色' },
      { id: '1050', name: 'WeJack - 英文男声', lang: 'en-US', gender: 'male', default: false, type: '标准音色' },
      { id: '1051', name: 'WeRose - 英文女声', lang: 'en-US', gender: 'female', default: false, type: '标准音色' }
    ]
  }

  /**
   * 获取支持的地域列表
   */
  getSupportedRegions() {
    return [
      { value: 'ap-beijing', label: '北京 (ap-beijing)' },
      { value: 'ap-shanghai', label: '上海 (ap-shanghai)' },
      { value: 'ap-guangzhou', label: '广州 (ap-guangzhou)' },
      { value: 'ap-chengdu', label: '成都 (ap-chengdu)' },
      { value: 'ap-chongqing', label: '重庆 (ap-chongqing)' },
      { value: 'ap-tianjin', label: '天津 (ap-tianjin)' },
      { value: 'ap-shenzhen-fsi', label: '深圳 (ap-shenzhen-fsi)' },
      { value: 'ap-hongkong', label: '香港 (ap-hongkong)' },
      { value: 'ap-singapore', label: '新加坡 (ap-singapore)' },
      { value: 'ap-tokyo', label: '东京 (ap-tokyo)' },
      { value: 'ap-seoul', label: '首尔 (ap-seoul)' },
      { value: 'ap-mumbai', label: '孟买 (ap-mumbai)' },
      { value: 'ap-bangkok', label: '曼谷 (ap-bangkok)' },
      { value: 'na-ashburn', label: '弗吉尼亚 (na-ashburn)' },
      { value: 'na-siliconvalley', label: '硅谷 (na-siliconvalley)' },
      { value: 'na-toronto', label: '多伦多 (na-toronto)' },
      { value: 'eu-frankfurt', label: '法兰克福 (eu-frankfurt)' },
      { value: 'eu-moscow', label: '莫斯科 (eu-moscow)' }
    ]
  }
}
