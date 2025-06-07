import { TTSVoice } from '@renderer/types/tts'

/**
 * TTS 提供商常量定义
 */

// OpenAI TTS 音色
export const OPENAI_TTS_VOICES: TTSVoice[] = [
  { id: 'alloy', name: 'Alloy', lang: 'en-US', gender: 'neutral' },
  { id: 'echo', name: 'Echo', lang: 'en-US', gender: 'male' },
  { id: 'fable', name: 'Fable', lang: 'en-US', gender: 'neutral' },
  { id: 'onyx', name: 'Onyx', lang: 'en-US', gender: 'male' },
  { id: 'nova', name: 'Nova', lang: 'en-US', gender: 'female' },
  { id: 'shimmer', name: 'Shimmer', lang: 'en-US', gender: 'female' }
]

// OpenAI TTS 模型
export const OPENAI_TTS_MODELS = [
  { id: 'tts-1', name: 'TTS-1 (标准)', description: '标准质量，速度快' },
  { id: 'tts-1-hd', name: 'TTS-1 HD (高清)', description: '高质量，速度较慢' }
]

// OpenAI TTS 音频格式
export const OPENAI_TTS_FORMATS = [
  { id: 'mp3', name: 'MP3', description: '压缩格式，文件小' },
  { id: 'opus', name: 'Opus', description: '高效压缩，适合流媒体' },
  { id: 'aac', name: 'AAC', description: '高质量压缩格式' },
  { id: 'flac', name: 'FLAC', description: '无损压缩格式' },
  { id: 'wav', name: 'WAV', description: '无压缩格式，文件大' },
  { id: 'pcm', name: 'PCM', description: '原始音频数据' }
]

// 腾讯云 TTS 音色 (完整列表)
export const TENCENT_TTS_VOICES: TTSVoice[] = [
  // 超自然大模型音色
  { id: '502004', name: '智小满 (营销女声)', lang: 'zh-CN', gender: 'female' },
  { id: '502003', name: '智小敏 (聊天女声)', lang: 'zh-CN', gender: 'female' },
  { id: '502001', name: '智小柔 (聊天女声)', lang: 'zh-CN', gender: 'female' },

  // 大模型音色
  { id: '501000', name: '智斌 (阅读男声)', lang: 'zh-CN', gender: 'male' },
  { id: '501001', name: '智兰 (资讯女声)', lang: 'zh-CN', gender: 'female' },
  { id: '501002', name: '智菊 (阅读女声)', lang: 'zh-CN', gender: 'female' },
  { id: '501003', name: '智宇 (阅读男声)', lang: 'zh-CN', gender: 'male' },
  { id: '501004', name: '月华 (聊天女声)', lang: 'zh-CN', gender: 'female' },
  { id: '501005', name: '飞镜 (聊天男声)', lang: 'zh-CN', gender: 'male' },
  { id: '501006', name: '千嶂 (聊天男声)', lang: 'zh-CN', gender: 'male' },
  { id: '501007', name: '浅草 (聊天男声)', lang: 'zh-CN', gender: 'male' },
  { id: '501008', name: 'WeJames (外语男声)', lang: 'en-US', gender: 'male' },
  { id: '501009', name: 'WeWinny (外语女声)', lang: 'en-US', gender: 'female' },

  // 大模型音色 (爱小系列)
  { id: '601015', name: '爱小童 (男童声)', lang: 'zh-CN', gender: 'male' },
  { id: '601000', name: '爱小溪 (聊天女声)', lang: 'zh-CN', gender: 'female' },
  { id: '601001', name: '爱小洛 (阅读女声)', lang: 'zh-CN', gender: 'female' },
  { id: '601002', name: '爱小辰 (聊天男声)', lang: 'zh-CN', gender: 'male' },
  { id: '601003', name: '爱小荷 (阅读女声)', lang: 'zh-CN', gender: 'female' },
  { id: '601004', name: '爱小树 (资讯男声)', lang: 'zh-CN', gender: 'male' },
  { id: '601005', name: '爱小静 (聊天女声)', lang: 'zh-CN', gender: 'female' },
  { id: '601006', name: '爱小耀 (阅读男声)', lang: 'zh-CN', gender: 'male' },
  { id: '601007', name: '爱小叶 (聊天女声)', lang: 'zh-CN', gender: 'female' },
  { id: '601008', name: '爱小豪 (聊天男声)', lang: 'zh-CN', gender: 'male' },
  { id: '601009', name: '爱小芊 (聊天女声)', lang: 'zh-CN', gender: 'female' },
  { id: '601010', name: '爱小娇 (聊天女声)', lang: 'zh-CN', gender: 'female' },
  { id: '601011', name: '爱小川 (聊天男声)', lang: 'zh-CN', gender: 'male' },
  { id: '601012', name: '爱小璟 (特色女声)', lang: 'zh-CN', gender: 'female' },
  { id: '601013', name: '爱小伊 (阅读女声)', lang: 'zh-CN', gender: 'female' },
  { id: '601014', name: '爱小简 (聊天男声)', lang: 'zh-CN', gender: 'male' },

  // 精品音色 (智系列)
  { id: '100510000', name: '智逍遥 (阅读男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101001', name: '智瑜 (情感女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101002', name: '智聆 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101003', name: '智美 (客服女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101004', name: '智云 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101005', name: '智莉 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101006', name: '智言 (助手女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101008', name: '智琪 (客服女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101009', name: '智芸 (知性女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101010', name: '智华 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101011', name: '智燕 (新闻女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101012', name: '智丹 (新闻女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101013', name: '智辉 (新闻男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101014', name: '智宁 (新闻男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101015', name: '智萌 (男童声)', lang: 'zh-CN', gender: 'male' },
  { id: '101016', name: '智甜 (女童声)', lang: 'zh-CN', gender: 'female' },
  { id: '101017', name: '智蓉 (情感女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101018', name: '智靖 (情感男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101019', name: '智彤 (粤语女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101020', name: '智刚 (新闻男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101021', name: '智瑞 (新闻男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101022', name: '智虹 (新闻女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101023', name: '智萱 (聊天女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101024', name: '智皓 (聊天男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101025', name: '智薇 (聊天女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101026', name: '智希 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101027', name: '智梅 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101028', name: '智洁 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101029', name: '智凯 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101030', name: '智柯 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101031', name: '智奎 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101032', name: '智芳 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101033', name: '智蓓 (客服女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101081', name: '智佳 (客服女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101080', name: '智英 (客服女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101034', name: '智莲 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101035', name: '智依 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101040', name: '智川 (四川女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101050', name: 'WeJack (英文男声)', lang: 'en-US', gender: 'male' },
  { id: '101051', name: 'WeRose (英文女声)', lang: 'en-US', gender: 'female' },
  { id: '101052', name: '智味 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101053', name: '智方 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101054', name: '智友 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101055', name: '智付 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '101056', name: '智林 (东北男声)', lang: 'zh-CN', gender: 'male' },
  { id: '101057', name: '智美子 (日语女声)', lang: 'ja-JP', gender: 'female' },

  // 精品音色 (爱小系列 - 301xxx)
  { id: '301000', name: '爱小广 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301001', name: '爱小栋 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301002', name: '爱小海 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301003', name: '爱小霞 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301004', name: '爱小玲 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301005', name: '爱小章 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301006', name: '爱小峰 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301007', name: '爱小亮 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301008', name: '爱小博 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301009', name: '爱小芸 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301010', name: '爱小秋 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301011', name: '爱小芳 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301012', name: '爱小琴 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301013', name: '爱小康 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301014', name: '爱小辉 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301015', name: '爱小璐 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301016', name: '爱小阳 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301017', name: '爱小泉 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301018', name: '爱小昆 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301019', name: '爱小诚 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301020', name: '爱小岚 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301021', name: '爱小茹 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301022', name: '爱小蓉 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301023', name: '爱小燕 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301024', name: '爱小莲 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301025', name: '爱小武 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301026', name: '爱小雪 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301027', name: '爱小媛 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301028', name: '爱小娴 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301029', name: '爱小涛 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301030', name: '爱小溪 (客服女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301031', name: '爱小树 (聊天男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301032', name: '爱小荷 (聊天女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301033', name: '爱小叶 (客服女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301034', name: '爱小杭 (聊天男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301035', name: '爱小梅 (聊天女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301036', name: '爱小柯 (聊天男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301037', name: '爱小静 (聊天女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301038', name: '爱小桃 (资讯女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301039', name: '爱小萌 (聊天女声)', lang: 'zh-CN', gender: 'female' },
  { id: '301040', name: '爱小星 (特色男声)', lang: 'zh-CN', gender: 'male' },
  { id: '301041', name: '爱小菲 (聊天女声)', lang: 'zh-CN', gender: 'female' },

  // 标准音色
  { id: '10510000', name: '智逍遥 (阅读男声)', lang: 'zh-CN', gender: 'male' },
  { id: '1001', name: '智瑜 (情感女声)', lang: 'zh-CN', gender: 'female' },
  { id: '1002', name: '智聆 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '1003', name: '智美 (客服女声)', lang: 'zh-CN', gender: 'female' },
  { id: '1004', name: '智云 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '1005', name: '智莉 (通用女声)', lang: 'zh-CN', gender: 'female' },
  { id: '1008', name: '智琪 (客服女声)', lang: 'zh-CN', gender: 'female' },
  { id: '1009', name: '智芸 (知性女声)', lang: 'zh-CN', gender: 'female' },
  { id: '1010', name: '智华 (通用男声)', lang: 'zh-CN', gender: 'male' },
  { id: '1017', name: '智蓉 (情感女声)', lang: 'zh-CN', gender: 'female' },
  { id: '1018', name: '智靖 (情感男声)', lang: 'zh-CN', gender: 'male' },
  { id: '1050', name: 'WeJack (英文男声)', lang: 'en-US', gender: 'male' },
  { id: '1051', name: 'WeRose (英文女声)', lang: 'en-US', gender: 'female' }
]

// 腾讯云 TTS 地域
export const TENCENT_TTS_REGIONS = [
  { id: 'ap-beijing', name: '北京', description: '华北地区(北京)' },
  { id: 'ap-shanghai', name: '上海', description: '华东地区(上海)' },
  { id: 'ap-guangzhou', name: '广州', description: '华南地区(广州)' },
  { id: 'ap-chengdu', name: '成都', description: '西南地区(成都)' },
  { id: 'ap-chongqing', name: '重庆', description: '西南地区(重庆)' },
  { id: 'ap-hongkong', name: '香港', description: '港澳台地区(中国香港)' },
  { id: 'ap-singapore', name: '新加坡', description: '亚太东南(新加坡)' },
  { id: 'ap-mumbai', name: '孟买', description: '亚太南部(孟买)' },
  { id: 'ap-seoul', name: '首尔', description: '亚太东北(首尔)' },
  { id: 'ap-tokyo', name: '东京', description: '亚太东北(东京)' },
  { id: 'na-siliconvalley', name: '硅谷', description: '美国西部(硅谷)' },
  { id: 'na-ashburn', name: '弗吉尼亚', description: '美国东部(弗吉尼亚)' },
  { id: 'eu-frankfurt', name: '法兰克福', description: '欧洲地区(法兰克福)' }
]

// 腾讯云 TTS 音频格式
export const TENCENT_TTS_CODECS = [
  { id: 'wav', name: 'WAV', description: '无压缩格式，质量最高' },
  { id: 'mp3', name: 'MP3', description: '压缩格式，文件较小' },
  { id: 'pcm', name: 'PCM', description: '原始音频数据，适合流式' }
]

// 腾讯云 TTS 采样率
export const TENCENT_TTS_SAMPLE_RATES = [
  { id: 8000, name: '8kHz', description: '电话质量' },
  { id: 16000, name: '16kHz', description: '标准质量' },
  { id: 24000, name: '24kHz', description: '高质量' }
]

// Azure Speech 地域
export const AZURE_SPEECH_REGIONS = [
  { id: 'eastus', name: '美国东部', description: 'East US' },
  { id: 'eastus2', name: '美国东部2', description: 'East US 2' },
  { id: 'westus', name: '美国西部', description: 'West US' },
  { id: 'westus2', name: '美国西部2', description: 'West US 2' },
  { id: 'centralus', name: '美国中部', description: 'Central US' },
  { id: 'northcentralus', name: '美国中北部', description: 'North Central US' },
  { id: 'southcentralus', name: '美国中南部', description: 'South Central US' },
  { id: 'westcentralus', name: '美国中西部', description: 'West Central US' },
  { id: 'canadacentral', name: '加拿大中部', description: 'Canada Central' },
  { id: 'brazilsouth', name: '巴西南部', description: 'Brazil South' },
  { id: 'northeurope', name: '北欧', description: 'North Europe' },
  { id: 'westeurope', name: '西欧', description: 'West Europe' },
  { id: 'uksouth', name: '英国南部', description: 'UK South' },
  { id: 'francecentral', name: '法国中部', description: 'France Central' },
  { id: 'germanywestcentral', name: '德国中西部', description: 'Germany West Central' },
  { id: 'norwayeast', name: '挪威东部', description: 'Norway East' },
  { id: 'switzerlandnorth', name: '瑞士北部', description: 'Switzerland North' },
  { id: 'eastasia', name: '东亚', description: 'East Asia' },
  { id: 'southeastasia', name: '东南亚', description: 'Southeast Asia' },
  { id: 'japaneast', name: '日本东部', description: 'Japan East' },
  { id: 'japanwest', name: '日本西部', description: 'Japan West' },
  { id: 'koreacentral', name: '韩国中部', description: 'Korea Central' },
  { id: 'australiaeast', name: '澳大利亚东部', description: 'Australia East' },
  { id: 'australiasoutheast', name: '澳大利亚东南部', description: 'Australia Southeast' },
  { id: 'centralindia', name: '印度中部', description: 'Central India' },
  { id: 'southindia', name: '印度南部', description: 'South India' },
  { id: 'westindia', name: '印度西部', description: 'West India' }
]

// ElevenLabs 模型
export const ELEVENLABS_MODELS = [
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2', description: '多语言模型，支持29种语言' },
  { id: 'eleven_multilingual_v1', name: 'Multilingual v1', description: '多语言模型v1' },
  { id: 'eleven_monolingual_v1', name: 'Monolingual v1', description: '英语单语言模型' },
  { id: 'eleven_turbo_v2', name: 'Turbo v2', description: '快速模型，低延迟' }
]

// 硅基流动 TTS 模型
export const SILICONFLOW_TTS_MODELS = [
  { id: 'FunAudioLLM/CosyVoice2-0.5B', name: 'CosyVoice2-0.5B', description: '高质量中英文语音合成' },
  { id: 'FunAudioLLM/CosyVoice-300M', name: 'CosyVoice-300M', description: '轻量级语音合成模型' }
]

// 硅基流动 TTS 音色
export const SILICONFLOW_TTS_VOICES: TTSVoice[] = [
  // 男声音色
  { id: 'alex', name: '沉稳男声 (Alex)', lang: 'zh-CN', gender: 'male', default: true },
  { id: 'benjamin', name: '低沉男声 (Benjamin)', lang: 'zh-CN', gender: 'male', default: false },
  { id: 'charles', name: '磁性男声 (Charles)', lang: 'zh-CN', gender: 'male', default: false },
  { id: 'david', name: '欢快男声 (David)', lang: 'zh-CN', gender: 'male', default: false },
  // 女声音色
  { id: 'anna', name: '沉稳女声 (Anna)', lang: 'zh-CN', gender: 'female', default: false },
  { id: 'bella', name: '激情女声 (Bella)', lang: 'zh-CN', gender: 'female', default: false },
  { id: 'claire', name: '温柔女声 (Claire)', lang: 'zh-CN', gender: 'female', default: false },
  { id: 'diana', name: '欢快女声 (Diana)', lang: 'zh-CN', gender: 'female', default: false }
]

// 硅基流动 TTS 音频格式
export const SILICONFLOW_TTS_FORMATS = [
  { id: 'mp3', name: 'MP3', description: '压缩格式，文件小' },
  { id: 'wav', name: 'WAV', description: '无压缩格式，质量高' },
  { id: 'flac', name: 'FLAC', description: '无损压缩格式' }
]

// 硅基流动 TTS 采样率
export const SILICONFLOW_TTS_SAMPLE_RATES = [
  { id: 16000, name: '16kHz', description: '标准质量' },
  { id: 22050, name: '22.05kHz', description: '高质量' },
  { id: 44100, name: '44.1kHz', description: 'CD质量' },
  { id: 48000, name: '48kHz', description: '专业质量' }
]

// Google Cloud TTS 常用音色（示例）
export const GOOGLE_TTS_VOICES = [
  { id: 'en-US-Wavenet-D', name: 'Wavenet-D (男声)', lang: 'en-US', gender: 'male' },
  { id: 'en-US-Wavenet-F', name: 'Wavenet-F (女声)', lang: 'en-US', gender: 'female' },
  { id: 'en-US-Neural2-A', name: 'Neural2-A (男声)', lang: 'en-US', gender: 'male' },
  { id: 'en-US-Neural2-C', name: 'Neural2-C (女声)', lang: 'en-US', gender: 'female' },
  { id: 'zh-CN-Wavenet-A', name: 'Wavenet-A (女声)', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-Wavenet-B', name: 'Wavenet-B (男声)', lang: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-Wavenet-C', name: 'Wavenet-C (男声)', lang: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-Wavenet-D', name: 'Wavenet-D (女声)', lang: 'zh-CN', gender: 'female' }
]

// Google Cloud TTS 音频格式
export const GOOGLE_TTS_FORMATS = [
  { id: 'mp3', name: 'MP3', description: '压缩格式' },
  { id: 'wav', name: 'WAV', description: '无压缩格式' },
  { id: 'ogg', name: 'OGG', description: 'OGG Vorbis格式' }
]

// Google Cloud TTS 采样率
export const GOOGLE_TTS_SAMPLE_RATES = [
  { id: 8000, name: '8kHz', description: '电话质量' },
  { id: 16000, name: '16kHz', description: '标准质量' },
  { id: 22050, name: '22.05kHz', description: '高质量' },
  { id: 24000, name: '24kHz', description: '高质量' },
  { id: 44100, name: '44.1kHz', description: 'CD质量' },
  { id: 48000, name: '48kHz', description: '专业质量' }
]

// 通用语速范围
export const TTS_RATE_RANGE = {
  min: 0.25,
  max: 4.0,
  default: 1.0,
  step: 0.1
}

// 通用音调范围
export const TTS_PITCH_RANGE = {
  min: 0.5,
  max: 2.0,
  default: 1.0,
  step: 0.1
}

// 通用音量范围
export const TTS_VOLUME_RANGE = {
  min: 0.0,
  max: 1.0,
  default: 1.0,
  step: 0.1
}

// 默认音色 ID
export const DEFAULT_VOICE_IDS = {
  openai: 'alloy',
  azure: 'en-US-AriaNeural',
  elevenlabs: 'EXAVITQu4vr4xnSDxMaL',
  siliconflow: 'alex',
  tencentcloud: '101001',
  googlecloud: 'en-US-Wavenet-D'
}

// 默认模型 ID
export const DEFAULT_MODEL_IDS = {
  openai: 'tts-1',
  siliconflow: 'FunAudioLLM/CosyVoice2-0.5B'
}

// 默认音频格式
export const DEFAULT_AUDIO_FORMATS = {
  openai: 'mp3',
  siliconflow: 'mp3',
  googlecloud: 'mp3'
}

// 默认地域
export const DEFAULT_REGIONS = {
  azure: 'eastus',
  tencentcloud: 'ap-beijing'
}

// 默认采样率
export const DEFAULT_SAMPLE_RATES = {
  tencentcloud: 16000,
  siliconflow: 44100,
  googlecloud: 24000
}

// Azure TTS 默认音色列表 (后备)
export const AZURE_TTS_DEFAULT_VOICES: TTSVoice[] = [
  // 英语语音
  { id: 'en-US-AriaNeural', name: 'Aria (English US)', lang: 'en-US', gender: 'female' },
  { id: 'en-US-DavisNeural', name: 'Davis (English US)', lang: 'en-US', gender: 'male' },
  { id: 'en-US-GuyNeural', name: 'Guy (English US)', lang: 'en-US', gender: 'male' },
  { id: 'en-US-JaneNeural', name: 'Jane (English US)', lang: 'en-US', gender: 'female' },
  { id: 'en-US-JennyNeural', name: 'Jenny (English US)', lang: 'en-US', gender: 'female' },
  { id: 'en-US-NancyNeural', name: 'Nancy (English US)', lang: 'en-US', gender: 'female' },
  { id: 'en-US-TonyNeural', name: 'Tony (English US)', lang: 'en-US', gender: 'male' },

  // 中文语音
  { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao (晓晓)', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-YunxiNeural', name: 'Yunxi (云希)', lang: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunyangNeural', name: 'Yunyang (云扬)', lang: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-XiaoyiNeural', name: 'Xiaoyi (晓伊)', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-YunfengNeural', name: 'Yunfeng (云枫)', lang: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-XiaomoNeural', name: 'Xiaomo (晓墨)', lang: 'zh-CN', gender: 'female' },

  // 其他语言
  { id: 'ja-JP-NanamiNeural', name: 'Nanami (Japanese)', lang: 'ja-JP', gender: 'female' },
  { id: 'ko-KR-SunHiNeural', name: 'SunHi (Korean)', lang: 'ko-KR', gender: 'female' },
  { id: 'fr-FR-DeniseNeural', name: 'Denise (French)', lang: 'fr-FR', gender: 'female' },
  { id: 'de-DE-KatjaNeural', name: 'Katja (German)', lang: 'de-DE', gender: 'female' }
]
