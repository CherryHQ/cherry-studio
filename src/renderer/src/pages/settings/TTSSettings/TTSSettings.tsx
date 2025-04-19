import { AudioOutlined, PhoneOutlined, PlusOutlined, ReloadOutlined, SoundOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import TTSService from '@renderer/services/TTSService'
import store, { useAppDispatch } from '@renderer/store'
import {
  addTtsCustomModel,
  addTtsCustomVoice,
  removeTtsCustomModel,
  removeTtsCustomVoice,
  resetTtsCustomValues,
  setShowTTSProgressBar,
  setTtsApiKey,
  setTtsApiUrl,
  setTtsEdgeVoice,
  setTtsEnabled,
  setTtsFilterOptions,
  setTtsModel,
  setTtsMsOutputFormat,
  setTtsMsVoice,
  setTtsServiceType,
  setTtsSiliconflowApiKey,
  setTtsSiliconflowApiUrl,
  setTtsSiliconflowModel,
  setTtsSiliconflowResponseFormat,
  setTtsSiliconflowSpeed,
  setTtsSiliconflowVoice,
  setTtsVoice
} from '@renderer/store/settings'
import { Button, Form, Input, InputNumber, message, Select, Space, Switch, Tabs, Tag } from 'antd'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import {
  SettingContainer,
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '..'
import ASRSettings from './ASRSettings'
import VoiceCallSettings from './VoiceCallSettings'

// 预定义的浏览器 TTS音色列表
const PREDEFINED_VOICES = [
  { label: '小晓 (女声, 中文)', value: 'zh-CN-XiaoxiaoNeural' },
  { label: '云扬 (男声, 中文)', value: 'zh-CN-YunyangNeural' },
  { label: '晓晓 (女声, 中文)', value: 'zh-CN-XiaoxiaoNeural' },
  { label: '晓涵 (女声, 中文)', value: 'zh-CN-XiaohanNeural' },
  { label: '晓诗 (女声, 中文)', value: 'zh-CN-XiaoshuangNeural' },
  { label: '晓瑞 (女声, 中文)', value: 'zh-CN-XiaoruiNeural' },
  { label: '晓墨 (女声, 中文)', value: 'zh-CN-XiaomoNeural' },
  { label: '晓然 (男声, 中文)', value: 'zh-CN-XiaoranNeural' },
  { label: '晓坤 (男声, 中文)', value: 'zh-CN-XiaokunNeural' },
  { label: 'Aria (Female, English)', value: 'en-US-AriaNeural' },
  { label: 'Guy (Male, English)', value: 'en-US-GuyNeural' },
  { label: 'Jenny (Female, English)', value: 'en-US-JennyNeural' },
  { label: 'Ana (Female, Spanish)', value: 'es-ES-ElviraNeural' },
  { label: 'Ichiro (Male, Japanese)', value: 'ja-JP-KeitaNeural' },
  { label: 'Nanami (Female, Japanese)', value: 'ja-JP-NanamiNeural' },
  // 添加更多常用的语音
  { label: 'Microsoft David (en-US)', value: 'Microsoft David Desktop - English (United States)' },
  { label: 'Microsoft Zira (en-US)', value: 'Microsoft Zira Desktop - English (United States)' },
  { label: 'Microsoft Mark (en-US)', value: 'Microsoft Mark Online (Natural) - English (United States)' },
  { label: 'Microsoft Aria (en-US)', value: 'Microsoft Aria Online (Natural) - English (United States)' },
  { label: 'Google US English', value: 'Google US English' },
  { label: 'Google UK English Female', value: 'Google UK English Female' },
  { label: 'Google UK English Male', value: 'Google UK English Male' },
  { label: 'Google 日本語', value: 'Google 日本語' },
  { label: 'Google 普通话（中国大陆）', value: 'Google 普通话（中国大陆）' },
  { label: 'Google 粤語（香港）', value: 'Google 粤語（香港）' }
]

const CustomVoiceInput = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const TagsContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  margin-bottom: 16px;
`

const EmptyText = styled.div`
  color: rgba(0, 0, 0, 0.45);
  padding: 4px 0;
`

const InputGroup = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
`

const FlexContainer = styled.div`
  display: flex;
  gap: 8px;
`

const FilterOptionItem = styled.div`
  margin-bottom: 16px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
`

const LengthLabel = styled.span`
  margin-right: 8px;
`

const LoadingText = styled.div`
  margin-top: 8px;
  color: #999;
`

const InfoText = styled.div`
  margin-top: 8px;
  font-size: 12px;
  color: #888;
`

const VoiceSelectContainer = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
`

const TTSSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  // 从Redux获取TTS设置
  const settings = useSelector((state: any) => state.settings)
  const ttsEnabled = settings.ttsEnabled
  const ttsServiceType = settings.ttsServiceType || 'openai'
  const ttsApiKey = settings.ttsApiKey
  const ttsApiUrl = settings.ttsApiUrl
  const ttsVoice = settings.ttsVoice
  const ttsModel = settings.ttsModel
  const ttsEdgeVoice = settings.ttsEdgeVoice || 'zh-CN-XiaoxiaoNeural'
  const ttsCustomVoices = settings.ttsCustomVoices || []
  const ttsCustomModels = settings.ttsCustomModels || []
  const showTTSProgressBar = settings.showTTSProgressBar
  // 免费在线TTS设置
  const ttsMsVoice = settings.ttsMsVoice || 'zh-CN-XiaoxiaoNeural'
  const ttsMsOutputFormat = settings.ttsMsOutputFormat || 'audio-24khz-48kbitrate-mono-mp3'

  // 确保免费在线TTS设置有默认值
  useEffect(() => {
    if (ttsServiceType === 'mstts') {
      if (!settings.ttsMsVoice) {
        dispatch(setTtsMsVoice('zh-CN-XiaoxiaoNeural'))
      }
      if (!settings.ttsMsOutputFormat) {
        dispatch(setTtsMsOutputFormat('audio-24khz-48kbitrate-mono-mp3'))
      }
    }
  }, [ttsServiceType, settings.ttsMsVoice, settings.ttsMsOutputFormat, dispatch])
  const ttsFilterOptions = settings.ttsFilterOptions || {
    filterThinkingProcess: true,
    filterMarkdown: true,
    filterCodeBlocks: true,
    filterHtmlTags: true,
    filterEmojis: true,
    maxTextLength: 4000
  }

  // 硅基流动TTS设置
  const ttsSiliconflowApiKey = settings.ttsSiliconflowApiKey
  const ttsSiliconflowApiUrl = settings.ttsSiliconflowApiUrl
  const ttsSiliconflowVoice = settings.ttsSiliconflowVoice
  const ttsSiliconflowModel = settings.ttsSiliconflowModel
  const ttsSiliconflowResponseFormat = settings.ttsSiliconflowResponseFormat
  const ttsSiliconflowSpeed = settings.ttsSiliconflowSpeed

  // 新增自定义音色和模型的状态
  const [newVoice, setNewVoice] = useState('')
  const [newModel, setNewModel] = useState('')

  // 浏览器可用的语音列表
  const [availableVoices, setAvailableVoices] = useState<{ label: string; value: string }[]>([])

  // 免费在线TTS可用的语音列表
  const [msTtsVoices, setMsTtsVoices] = useState<{ label: string; value: string }[]>([])

  // 获取免费在线TTS可用的语音列表
  const getMsTtsVoices = useCallback(async () => {
    try {
      // 调用API获取免费在线TTS语音列表
      const response = await window.api.msTTS.getVoices()
      console.log('获取到的免费在线TTS语音列表:', response)

      // 转换为选项格式
      const voices = response.map((voice: any) => ({
        label: `${voice.ShortName} (${voice.Gender === 'Female' ? '女声' : '男声'})`,
        value: voice.ShortName
      }))

      // 按语言和性别排序
      voices.sort((a: any, b: any) => {
        const localeA = a.value.split('-')[0] + a.value.split('-')[1]
        const localeB = b.value.split('-')[0] + b.value.split('-')[1]
        if (localeA !== localeB) return localeA.localeCompare(localeB)
        return a.label.localeCompare(b.label)
      })

      setMsTtsVoices(voices)
    } catch (error) {
      console.error('获取免费在线TTS语音列表失败:', error)
      // 如果获取失败，设置一些默认的中文语音
      setMsTtsVoices([
        { label: 'zh-CN-XiaoxiaoNeural (女声)', value: 'zh-CN-XiaoxiaoNeural' },
        { label: 'zh-CN-YunxiNeural (男声)', value: 'zh-CN-YunxiNeural' },
        { label: 'zh-CN-YunyangNeural (男声)', value: 'zh-CN-YunyangNeural' },
        { label: 'zh-CN-XiaohanNeural (女声)', value: 'zh-CN-XiaohanNeural' },
        { label: 'zh-CN-XiaomoNeural (女声)', value: 'zh-CN-XiaomoNeural' },
        { label: 'zh-CN-XiaoxuanNeural (女声)', value: 'zh-CN-XiaoxuanNeural' },
        { label: 'zh-CN-XiaoruiNeural (女声)', value: 'zh-CN-XiaoruiNeural' },
        { label: 'zh-CN-YunfengNeural (男声)', value: 'zh-CN-YunfengNeural' }
      ])
    }
  }, [])

  // 获取浏览器可用的语音列表
  const getVoices = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      // 先触发一下语音合成引擎，确保它已经初始化
      window.speechSynthesis.cancel()

      // 获取浏览器可用的语音列表
      const voices = window.speechSynthesis.getVoices()
      console.log('获取到的语音列表:', voices)
      console.log('语音列表长度:', voices.length)

      // 转换浏览器语音列表为选项格式
      const browserVoices = voices.map((voice) => ({
        label: `${voice.name} (${voice.lang})${voice.default ? ' - 默认' : ''}`,
        value: voice.name,
        lang: voice.lang,
        isNative: true // 标记为浏览器原生语音
      }))

      // 添加语言信息到预定义语音
      const enhancedPredefinedVoices = PREDEFINED_VOICES.map((voice) => ({
        ...voice,
        lang: voice.value.split('-').slice(0, 2).join('-'),
        isNative: false // 标记为非浏览器原生语音
      }))

      // 合并所有语音列表
      // 只使用浏览器原生语音，因为预定义语音实际不可用
      let allVoices = [...browserVoices]

      // 如果浏览器没有可用语音，才使用预定义语音
      if (browserVoices.length === 0) {
        allVoices = [...enhancedPredefinedVoices]
        console.log('浏览器没有可用语音，使用预定义语音')
      } else {
        console.log('使用浏览器原生语音，共' + browserVoices.length + '个')
      }

      // 去除重复项，优先保留浏览器原生语音
      const uniqueVoices = allVoices.filter((voice, index, self) => {
        const firstIndex = self.findIndex((v) => v.value === voice.value)
        // 如果是原生语音或者是第一次出现，则保留
        return voice.isNative || firstIndex === index
      })

      // 按语言分组并排序
      const groupedVoices = uniqueVoices.sort((a, b) => {
        // 先按语言排序
        if (a.lang !== b.lang) {
          return a.lang.localeCompare(b.lang)
        }
        // 同语言下，原生语音优先
        if (a.isNative !== b.isNative) {
          return a.isNative ? -1 : 1
        }
        // 最后按名称排序
        return a.label.localeCompare(b.label)
      })

      setAvailableVoices(groupedVoices)
      console.log('设置可用语音列表:', groupedVoices)
    } else {
      // 如果浏览器不支持Web Speech API，使用预定义的语音列表
      console.log('浏览器不支持Web Speech API，使用预定义的语音列表')
      setAvailableVoices(PREDEFINED_VOICES)
    }
  }, [])

  // 刷新语音列表
  const refreshVoices = useCallback(() => {
    console.log('手动刷新语音列表')
    message.loading({
      content: t('settings.tts.edge_voice.refreshing', { defaultValue: '正在刷新语音列表...' }),
      key: 'refresh-voices'
    })

    // 先清空当前列表
    setAvailableVoices([])

    // 强制重新加载语音列表
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()

      // 尝试多次获取语音列表
      setTimeout(() => {
        getVoices()
        setTimeout(() => {
          getVoices()
          message.success({
            content: t('settings.tts.edge_voice.refreshed', { defaultValue: '语音列表已刷新' }),
            key: 'refresh-voices'
          })
        }, 1000)
      }, 500)
    } else {
      // 如果浏览器不支持Web Speech API，使用预定义的语音列表
      setAvailableVoices(PREDEFINED_VOICES)
      message.success({
        content: t('settings.tts.edge_voice.refreshed', { defaultValue: '语音列表已刷新' }),
        key: 'refresh-voices'
      })
    }
  }, [getVoices, t])

  // 获取免费在线TTS语音列表
  useEffect(() => {
    // 获取免费在线TTS语音列表
    getMsTtsVoices()
  }, [getMsTtsVoices])

  useEffect(() => {
    // 初始化语音合成引擎
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      // 触发语音合成引擎初始化
      window.speechSynthesis.cancel()

      // 设置voiceschanged事件处理程序
      const voicesChangedHandler = () => {
        console.log('检测到voiceschanged事件，重新获取语音列表')
        getVoices()
      }

      // 添加事件监听器
      window.speechSynthesis.onvoiceschanged = voicesChangedHandler

      // 立即获取可用的语音
      getVoices()

      // 创建多个定时器，在不同时间点尝试获取语音列表
      // 这是因为不同浏览器加载语音列表的时间不同
      const timers = [
        setTimeout(() => getVoices(), 500),
        setTimeout(() => getVoices(), 1000),
        setTimeout(() => getVoices(), 2000)
      ]

      return () => {
        // 清理事件监听器和定时器
        window.speechSynthesis.onvoiceschanged = null
        timers.forEach((timer) => clearTimeout(timer))
      }
    } else {
      // 如果浏览器不支持Web Speech API，使用预定义的语音列表
      setAvailableVoices(PREDEFINED_VOICES)
      return () => {}
    }
  }, [getVoices])

  // 测试TTS功能
  const testTTS = async () => {
    if (!ttsEnabled) {
      window.message.error({ content: t('settings.tts.error.not_enabled'), key: 'tts-test' })
      return
    }

    // 如果是免费在线TTS，确保音色已设置
    if (ttsServiceType === 'mstts' && !ttsMsVoice) {
      // 自动设置默认音色
      dispatch(setTtsMsVoice('zh-CN-XiaoxiaoNeural'))
      window.message.info({
        content: t('settings.tts.mstts.auto_set_voice', { defaultValue: '已自动设置默认音色' }),
        key: 'tts-test'
      })
    }

    // 强制刷新状态，确保使用最新的设置
    // 先获取当前的服务类型
    const currentType = store.getState().settings.ttsServiceType || 'openai'
    console.log('测试前当前的TTS服务类型:', currentType)

    // 获取最新的服务类型设置
    const latestSettings = store.getState().settings
    const currentServiceType = latestSettings.ttsServiceType || 'openai'
    console.log('测试TTS时使用的服务类型:', currentServiceType)
    console.log('测试时完整TTS设置:', {
      ttsEnabled: latestSettings.ttsEnabled,
      ttsServiceType: latestSettings.ttsServiceType,
      ttsApiKey: latestSettings.ttsApiKey ? '已设置' : '未设置',
      ttsVoice: latestSettings.ttsVoice,
      ttsModel: latestSettings.ttsModel,
      ttsEdgeVoice: latestSettings.ttsEdgeVoice,
      ttsSiliconflowApiKey: latestSettings.ttsSiliconflowApiKey ? '已设置' : '未设置',
      ttsSiliconflowVoice: latestSettings.ttsSiliconflowVoice,
      ttsSiliconflowModel: latestSettings.ttsSiliconflowModel,
      ttsSiliconflowResponseFormat: latestSettings.ttsSiliconflowResponseFormat,
      ttsSiliconflowSpeed: latestSettings.ttsSiliconflowSpeed
    })

    // 根据服务类型检查必要的参数
    if (currentServiceType === 'openai') {
      if (!ttsApiKey) {
        window.message.error({ content: t('settings.tts.error.no_api_key'), key: 'tts-test' })
        return
      }

      if (!ttsVoice) {
        window.message.error({ content: t('settings.tts.error.no_voice'), key: 'tts-test' })
        return
      }

      if (!ttsModel) {
        window.message.error({ content: t('settings.tts.error.no_model'), key: 'tts-test' })
        return
      }
    } else if (currentServiceType === 'edge') {
      if (!ttsEdgeVoice) {
        window.message.error({ content: t('settings.tts.error.no_edge_voice'), key: 'tts-test' })
        return
      }
    } else if (currentServiceType === 'siliconflow') {
      const ttsSiliconflowApiKey = latestSettings.ttsSiliconflowApiKey
      const ttsSiliconflowVoice = latestSettings.ttsSiliconflowVoice
      const ttsSiliconflowModel = latestSettings.ttsSiliconflowModel

      if (!ttsSiliconflowApiKey) {
        window.message.error({ content: t('settings.tts.error.no_api_key'), key: 'tts-test' })
        return
      }

      if (!ttsSiliconflowVoice) {
        window.message.error({ content: t('settings.tts.error.no_voice'), key: 'tts-test' })
        return
      }

      if (!ttsSiliconflowModel) {
        window.message.error({ content: t('settings.tts.error.no_model'), key: 'tts-test' })
        return
      }
    }

    await TTSService.speak('这是一段测试语音，用于测试TTS功能是否正常工作。')
  }

  // 添加自定义音色
  const handleAddVoice = () => {
    if (!newVoice) {
      window.message.error({ content: '请输入音色', key: 'add-voice' })
      return
    }

    // 确保添加的是字符串
    const voiceStr = typeof newVoice === 'string' ? newVoice : String(newVoice)
    dispatch(addTtsCustomVoice(voiceStr))
    setNewVoice('')
  }

  // 添加自定义模型
  const handleAddModel = () => {
    if (!newModel) {
      window.message.error({ content: '请输入模型', key: 'add-model' })
      return
    }

    // 确保添加的是字符串
    const modelStr = typeof newModel === 'string' ? newModel : String(newModel)
    dispatch(addTtsCustomModel(modelStr))
    setNewModel('')
  }

  // 删除自定义音色
  const handleRemoveVoice = (voice: string) => {
    // 确保删除的是字符串
    const voiceStr = typeof voice === 'string' ? voice : String(voice)
    dispatch(removeTtsCustomVoice(voiceStr))
  }

  // 删除自定义模型
  const handleRemoveModel = (model: string) => {
    // 确保删除的是字符串
    const modelStr = typeof model === 'string' ? model : String(model)
    dispatch(removeTtsCustomModel(modelStr))
  }

  return (
    <SettingContainer theme={theme}>
      <SettingTitle>
        <Space>
          <SoundOutlined />
          {t('settings.voice.title')}
        </Space>
      </SettingTitle>
      <SettingDivider />
      <Tabs
        defaultActiveKey="tts"
        items={[
          {
            key: 'tts',
            label: (
              <span>
                <SoundOutlined /> {t('settings.tts.tab_title')}
              </span>
            ),
            children: (
              <div>
                <SettingGroup>
                  <SettingRow>
                    <SettingRowTitle>{t('settings.tts.enable')}</SettingRowTitle>
                    <Switch checked={ttsEnabled} onChange={(checked) => dispatch(setTtsEnabled(checked))} />
                  </SettingRow>
                  <SettingHelpText>{t('settings.tts.enable.help')}</SettingHelpText>
                </SettingGroup>

                {/* 重置按钮 */}
                <SettingGroup>
                  <SettingRow>
                    <SettingRowTitle>{t('settings.tts.reset_title')}</SettingRowTitle>
                    <Button
                      danger
                      onClick={() => {
                        if (window.confirm(t('settings.tts.reset_confirm'))) {
                          dispatch(resetTtsCustomValues())
                          window.message.success({ content: t('settings.tts.reset_success'), key: 'reset-tts' })
                        }
                      }}>
                      {t('settings.tts.reset')}
                    </Button>
                  </SettingRow>
                  <SettingHelpText>{t('settings.tts.reset_help')}</SettingHelpText>
                </SettingGroup>
                <SettingGroup>
                  <SettingRowTitle>{t('settings.tts.api_settings')}</SettingRowTitle>
                  <Form layout="vertical" style={{ width: '100%', marginTop: 16 }}>
                    {/* TTS服务类型选择 */}
                    <Form.Item label={t('settings.tts.service_type')} style={{ marginBottom: 16 }}>
                      <FlexContainer>
                        <Select
                          value={ttsServiceType}
                          onChange={(value: string) => {
                            console.log('切换TTS服务类型为:', value)
                            // 直接将新的服务类型写入Redux状态
                            dispatch(setTtsServiceType(value))
                          }}
                          options={[
                            { label: t('settings.tts.service_type.openai'), value: 'openai' },
                            { label: t('settings.tts.service_type.edge'), value: 'edge' },
                            { label: t('settings.tts.service_type.siliconflow'), value: 'siliconflow' },
                            { label: t('settings.tts.service_type.mstts'), value: 'mstts' }
                          ]}
                          disabled={!ttsEnabled}
                          style={{ flex: 1 }}
                        />
                        <Button
                          icon={<ReloadOutlined />}
                          onClick={() => {
                            // 强制刷新当前服务类型设置
                            const currentType = store.getState().settings.ttsServiceType
                            console.log('强制刷新TTS服务类型:', currentType)
                            dispatch(setTtsServiceType(currentType))
                            window.message.success({
                              content: t('settings.tts.service_type.refreshed', {
                                defaultValue: '已刷新TTS服务类型设置'
                              }),
                              key: 'tts-refresh'
                            })
                          }}
                          disabled={!ttsEnabled}
                          title={t('settings.tts.service_type.refresh', { defaultValue: '刷新TTS服务类型设置' })}
                        />
                      </FlexContainer>
                    </Form.Item>

                    {/* OpenAI TTS设置 */}
                    {ttsServiceType === 'openai' && (
                      <>
                        <Form.Item label={t('settings.tts.api_key')} style={{ marginBottom: 16 }}>
                          <Input.Password
                            value={ttsApiKey}
                            onChange={(e) => dispatch(setTtsApiKey(e.target.value))}
                            placeholder={t('settings.tts.api_key.placeholder')}
                            disabled={!ttsEnabled}
                          />
                        </Form.Item>
                        <Form.Item label={t('settings.tts.api_url')} style={{ marginBottom: 16 }}>
                          <Input
                            value={ttsApiUrl}
                            onChange={(e) => dispatch(setTtsApiUrl(e.target.value))}
                            placeholder={t('settings.tts.api_url.placeholder')}
                            disabled={!ttsEnabled}
                          />
                        </Form.Item>
                      </>
                    )}

                    {/* 硅基流动 TTS设置 */}
                    {ttsServiceType === 'siliconflow' && (
                      <>
                        <Form.Item label={t('settings.tts.siliconflow_api_key')} style={{ marginBottom: 16 }}>
                          <Input.Password
                            value={ttsSiliconflowApiKey}
                            onChange={(e) => dispatch(setTtsSiliconflowApiKey(e.target.value))}
                            placeholder={t('settings.tts.siliconflow_api_key.placeholder')}
                            disabled={!ttsEnabled}
                          />
                        </Form.Item>
                        <Form.Item label={t('settings.tts.siliconflow_api_url')} style={{ marginBottom: 16 }}>
                          <Input
                            value={ttsSiliconflowApiUrl}
                            onChange={(e) => dispatch(setTtsSiliconflowApiUrl(e.target.value))}
                            placeholder={t('settings.tts.siliconflow_api_url.placeholder')}
                            disabled={!ttsEnabled}
                          />
                        </Form.Item>
                        <Form.Item label={t('settings.tts.siliconflow_voice')} style={{ marginBottom: 16 }}>
                          <Select
                            value={ttsSiliconflowVoice}
                            onChange={(value) => dispatch(setTtsSiliconflowVoice(value))}
                            options={[
                              { label: 'alex (沉稳男声)', value: 'FunAudioLLM/CosyVoice2-0.5B:alex' },
                              { label: 'benjamin (低沉男声)', value: 'FunAudioLLM/CosyVoice2-0.5B:benjamin' },
                              { label: 'charles (磁性男声)', value: 'FunAudioLLM/CosyVoice2-0.5B:charles' },
                              { label: 'david (欢快男声)', value: 'FunAudioLLM/CosyVoice2-0.5B:david' },
                              { label: 'anna (沉稳女声)', value: 'FunAudioLLM/CosyVoice2-0.5B:anna' },
                              { label: 'bella (激情女声)', value: 'FunAudioLLM/CosyVoice2-0.5B:bella' },
                              { label: 'claire (温柔女声)', value: 'FunAudioLLM/CosyVoice2-0.5B:claire' },
                              { label: 'diana (欢快女声)', value: 'FunAudioLLM/CosyVoice2-0.5B:diana' }
                            ]}
                            disabled={!ttsEnabled}
                            style={{ width: '100%' }}
                            placeholder={t('settings.tts.siliconflow_voice.placeholder')}
                            showSearch
                            optionFilterProp="label"
                            allowClear
                          />
                        </Form.Item>
                        <Form.Item label={t('settings.tts.siliconflow_model')} style={{ marginBottom: 16 }}>
                          <Select
                            value={ttsSiliconflowModel}
                            onChange={(value) => dispatch(setTtsSiliconflowModel(value))}
                            options={[{ label: 'FunAudioLLM/CosyVoice2-0.5B', value: 'FunAudioLLM/CosyVoice2-0.5B' }]}
                            disabled={!ttsEnabled}
                            style={{ width: '100%' }}
                            placeholder={t('settings.tts.siliconflow_model.placeholder')}
                            showSearch
                            optionFilterProp="label"
                            allowClear
                          />
                        </Form.Item>
                        <Form.Item label={t('settings.tts.siliconflow_response_format')} style={{ marginBottom: 16 }}>
                          <Select
                            value={ttsSiliconflowResponseFormat}
                            onChange={(value) => dispatch(setTtsSiliconflowResponseFormat(value))}
                            options={[
                              { label: 'MP3', value: 'mp3' },
                              { label: 'OPUS', value: 'opus' },
                              { label: 'WAV', value: 'wav' },
                              { label: 'PCM', value: 'pcm' }
                            ]}
                            disabled={!ttsEnabled}
                            style={{ width: '100%' }}
                            placeholder={t('settings.tts.siliconflow_response_format.placeholder')}
                          />
                        </Form.Item>
                        <Form.Item label={t('settings.tts.siliconflow_speed')} style={{ marginBottom: 16 }}>
                          <InputNumber
                            value={ttsSiliconflowSpeed}
                            onChange={(value) => dispatch(setTtsSiliconflowSpeed(value as number))}
                            min={0.5}
                            max={2.0}
                            step={0.1}
                            disabled={!ttsEnabled}
                            style={{ width: '100%' }}
                            placeholder={t('settings.tts.siliconflow_speed.placeholder')}
                          />
                        </Form.Item>
                      </>
                    )}

                    {/* 浏览器 TTS设置 */}
                    {ttsServiceType === 'edge' && (
                      <Form.Item label={t('settings.tts.edge_voice')} style={{ marginBottom: 16 }}>
                        <VoiceSelectContainer>
                          <Select
                            value={ttsEdgeVoice}
                            onChange={(value) => dispatch(setTtsEdgeVoice(value))}
                            options={
                              availableVoices.length > 0
                                ? availableVoices
                                : [{ label: t('settings.tts.edge_voice.loading'), value: '' }]
                            }
                            disabled={!ttsEnabled}
                            style={{ flex: 1 }}
                            showSearch
                            optionFilterProp="label"
                            placeholder={
                              availableVoices.length === 0
                                ? t('settings.tts.edge_voice.loading')
                                : t('settings.tts.voice.placeholder')
                            }
                            notFoundContent={
                              availableVoices.length === 0
                                ? t('settings.tts.edge_voice.loading')
                                : t('settings.tts.edge_voice.not_found')
                            }
                          />
                          <Button
                            icon={<ReloadOutlined />}
                            onClick={refreshVoices}
                            disabled={!ttsEnabled}
                            title={t('settings.tts.edge_voice.refresh')}
                          />
                        </VoiceSelectContainer>
                        {availableVoices.length === 0 && (
                          <LoadingText>{t('settings.tts.edge_voice.loading')}</LoadingText>
                        )}
                        {availableVoices.length > 0 && (
                          <InfoText>
                            {t('settings.tts.edge_voice.available_count', { count: availableVoices.length })}
                          </InfoText>
                        )}
                      </Form.Item>
                    )}

                    {/* 免费在线 TTS设置 */}
                    {ttsServiceType === 'mstts' && (
                      <>
                        <Form.Item label={t('settings.tts.mstts.voice')} style={{ marginBottom: 16 }}>
                          <VoiceSelectContainer>
                            <Select
                              value={ttsMsVoice}
                              onChange={(value) => dispatch(setTtsMsVoice(value))}
                              disabled={!ttsEnabled}
                              style={{ width: '100%' }}
                              options={
                                msTtsVoices.length > 0
                                  ? msTtsVoices
                                  : [
                                      { label: 'zh-CN-XiaoxiaoNeural (女声)', value: 'zh-CN-XiaoxiaoNeural' },
                                      { label: 'zh-CN-YunxiNeural (男声)', value: 'zh-CN-YunxiNeural' },
                                      { label: 'zh-CN-YunyangNeural (男声)', value: 'zh-CN-YunyangNeural' },
                                      { label: 'zh-CN-XiaohanNeural (女声)', value: 'zh-CN-XiaohanNeural' },
                                      { label: 'zh-CN-XiaomoNeural (女声)', value: 'zh-CN-XiaomoNeural' },
                                      { label: 'zh-CN-XiaoxuanNeural (女声)', value: 'zh-CN-XiaoxuanNeural' },
                                      { label: 'zh-CN-XiaoruiNeural (女声)', value: 'zh-CN-XiaoruiNeural' },
                                      { label: 'zh-CN-YunfengNeural (男声)', value: 'zh-CN-YunfengNeural' }
                                    ]
                              }
                              showSearch
                              optionFilterProp="label"
                              placeholder={t('settings.tts.voice.placeholder', { defaultValue: '请选择音色' })}
                              notFoundContent={t('settings.tts.voice.not_found', { defaultValue: '未找到音色' })}
                            />
                            <Button
                              icon={<ReloadOutlined />}
                              onClick={() => getMsTtsVoices()}
                              disabled={!ttsEnabled}
                              title={t('settings.tts.mstts.refresh', { defaultValue: '刷新语音列表' })}
                            />
                          </VoiceSelectContainer>
                          {msTtsVoices.length > 0 && (
                            <InfoText>
                              {t('settings.tts.mstts.available_count', {
                                count: msTtsVoices.length,
                                defaultValue: '可用语音: {{count}}个'
                              })}
                            </InfoText>
                          )}
                        </Form.Item>
                        <Form.Item label={t('settings.tts.mstts.output_format')} style={{ marginBottom: 16 }}>
                          <Select
                            value={ttsMsOutputFormat}
                            onChange={(value) => dispatch(setTtsMsOutputFormat(value))}
                            disabled={!ttsEnabled}
                            style={{ width: '100%' }}
                            options={[
                              { label: 'MP3 (24kHz, 48kbps)', value: 'audio-24khz-48kbitrate-mono-mp3' },
                              { label: 'MP3 (24kHz, 96kbps)', value: 'audio-24khz-96kbitrate-mono-mp3' },
                              { label: 'Webm (24kHz)', value: 'webm-24khz-16bit-mono-opus' }
                            ]}
                          />
                        </Form.Item>
                        <InfoText>
                          {t('settings.tts.mstts.info', {
                            defaultValue: '免费在线TTS服务不需要API密钥，完全免费使用。'
                          })}
                        </InfoText>
                      </>
                    )}

                    {/* OpenAI TTS的音色和模型设置 */}
                    {ttsServiceType === 'openai' && (
                      <>
                        {/* 音色选择 */}
                        <Form.Item label={t('settings.tts.voice')} style={{ marginBottom: 8 }}>
                          <Select
                            value={ttsVoice}
                            onChange={(value) => dispatch(setTtsVoice(value))}
                            options={ttsCustomVoices.map((voice: any) => {
                              // 确保voice是字符串
                              const voiceStr = typeof voice === 'string' ? voice : String(voice)
                              return { label: voiceStr, value: voiceStr }
                            })}
                            disabled={!ttsEnabled}
                            style={{ width: '100%' }}
                            placeholder={t('settings.tts.voice.placeholder')}
                            showSearch
                            optionFilterProp="label"
                            allowClear
                          />
                        </Form.Item>

                        {/* 自定义音色列表 */}
                        <TagsContainer>
                          {ttsCustomVoices && ttsCustomVoices.length > 0 ? (
                            ttsCustomVoices.map((voice: any, index: number) => {
                              // 确保voice是字符串
                              const voiceStr = typeof voice === 'string' ? voice : String(voice)
                              return (
                                <Tag
                                  key={`${voiceStr}-${index}`}
                                  closable
                                  onClose={() => handleRemoveVoice(voiceStr)}
                                  style={{ padding: '4px 8px' }}>
                                  {voiceStr}
                                </Tag>
                              )
                            })
                          ) : (
                            <EmptyText>{t('settings.tts.voice_empty')}</EmptyText>
                          )}
                        </TagsContainer>

                        {/* 添加自定义音色 */}
                        <CustomVoiceInput>
                          <InputGroup>
                            <Input
                              placeholder={t('settings.tts.voice_input_placeholder')}
                              value={newVoice}
                              onChange={(e) => setNewVoice(e.target.value)}
                              disabled={!ttsEnabled}
                              style={{ flex: 1 }}
                            />
                            <Button
                              type="primary"
                              icon={<PlusOutlined />}
                              onClick={handleAddVoice}
                              disabled={!ttsEnabled || !newVoice}>
                              {t('settings.tts.voice_add')}
                            </Button>
                          </InputGroup>
                        </CustomVoiceInput>

                        {/* 模型选择 */}
                        <Form.Item label={t('settings.tts.model')} style={{ marginBottom: 8, marginTop: 16 }}>
                          <Select
                            value={ttsModel}
                            onChange={(value) => dispatch(setTtsModel(value))}
                            options={ttsCustomModels.map((model: any) => {
                              // 确保model是字符串
                              const modelStr = typeof model === 'string' ? model : String(model)
                              return { label: modelStr, value: modelStr }
                            })}
                            disabled={!ttsEnabled}
                            style={{ width: '100%' }}
                            placeholder={t('settings.tts.model.placeholder')}
                            showSearch
                            optionFilterProp="label"
                            allowClear
                          />
                        </Form.Item>

                        {/* 自定义模型列表 */}
                        <TagsContainer>
                          {ttsCustomModels && ttsCustomModels.length > 0 ? (
                            ttsCustomModels.map((model: any, index: number) => {
                              // 确保model是字符串
                              const modelStr = typeof model === 'string' ? model : String(model)
                              return (
                                <Tag
                                  key={`${modelStr}-${index}`}
                                  closable
                                  onClose={() => handleRemoveModel(modelStr)}
                                  style={{ padding: '4px 8px' }}>
                                  {modelStr}
                                </Tag>
                              )
                            })
                          ) : (
                            <EmptyText>{t('settings.tts.model_empty')}</EmptyText>
                          )}
                        </TagsContainer>

                        {/* 添加自定义模型 */}
                        <CustomVoiceInput>
                          <InputGroup>
                            <Input
                              placeholder={t('settings.tts.model_input_placeholder')}
                              value={newModel}
                              onChange={(e) => setNewModel(e.target.value)}
                              disabled={!ttsEnabled}
                              style={{ flex: 1 }}
                            />
                            <Button
                              type="primary"
                              icon={<PlusOutlined />}
                              onClick={handleAddModel}
                              disabled={!ttsEnabled || !newModel}>
                              {t('settings.tts.model_add')}
                            </Button>
                          </InputGroup>
                        </CustomVoiceInput>
                      </>
                    )}

                    {/* TTS过滤选项 */}
                    <Form.Item label={t('settings.tts.filter_options')} style={{ marginTop: 24, marginBottom: 8 }}>
                      <FilterOptionItem>
                        <Switch
                          checked={showTTSProgressBar}
                          onChange={(checked) => dispatch(setShowTTSProgressBar(checked))}
                          disabled={!ttsEnabled}
                        />{' '}
                        {t('settings.tts.show_progress_bar', { defaultValue: '显示TTS进度条' })}
                      </FilterOptionItem>
                      <FilterOptionItem>
                        <Switch
                          checked={ttsFilterOptions.filterThinkingProcess}
                          onChange={(checked) => dispatch(setTtsFilterOptions({ filterThinkingProcess: checked }))}
                          disabled={!ttsEnabled}
                        />{' '}
                        {t('settings.tts.filter.thinking_process')}
                      </FilterOptionItem>
                      <FilterOptionItem>
                        <Switch
                          checked={ttsFilterOptions.filterMarkdown}
                          onChange={(checked) => dispatch(setTtsFilterOptions({ filterMarkdown: checked }))}
                          disabled={!ttsEnabled}
                        />{' '}
                        {t('settings.tts.filter.markdown')}
                      </FilterOptionItem>
                      <FilterOptionItem>
                        <Switch
                          checked={ttsFilterOptions.filterCodeBlocks}
                          onChange={(checked) => dispatch(setTtsFilterOptions({ filterCodeBlocks: checked }))}
                          disabled={!ttsEnabled}
                        />{' '}
                        {t('settings.tts.filter.code_blocks')}
                      </FilterOptionItem>
                      <FilterOptionItem>
                        <Switch
                          checked={ttsFilterOptions.filterHtmlTags}
                          onChange={(checked) => dispatch(setTtsFilterOptions({ filterHtmlTags: checked }))}
                          disabled={!ttsEnabled}
                        />{' '}
                        {t('settings.tts.filter.html_tags')}
                      </FilterOptionItem>
                      <FilterOptionItem>
                        <Switch
                          checked={ttsFilterOptions.filterEmojis}
                          onChange={(checked) => dispatch(setTtsFilterOptions({ filterEmojis: checked }))}
                          disabled={!ttsEnabled}
                        />{' '}
                        {t('settings.tts.filter.emojis', { defaultValue: '过滤表情符号' })}
                      </FilterOptionItem>
                      <FilterOptionItem>
                        <LengthLabel>{t('settings.tts.max_text_length')}:</LengthLabel>
                        <Select
                          value={ttsFilterOptions.maxTextLength}
                          onChange={(value) => dispatch(setTtsFilterOptions({ maxTextLength: value }))}
                          disabled={!ttsEnabled}
                          style={{ width: 120 }}
                          options={[
                            { label: '1000', value: 1000 },
                            { label: '2000', value: 2000 },
                            { label: '4000', value: 4000 },
                            { label: '8000', value: 8000 },
                            { label: '16000', value: 16000 }
                          ]}
                        />
                      </FilterOptionItem>
                    </Form.Item>

                    <Form.Item style={{ marginTop: 16 }}>
                      <Button
                        type="primary"
                        onClick={testTTS}
                        disabled={
                          !ttsEnabled ||
                          (ttsServiceType === 'openai' && (!ttsApiKey || !ttsVoice || !ttsModel)) ||
                          (ttsServiceType === 'edge' && !ttsEdgeVoice) ||
                          (ttsServiceType === 'siliconflow' &&
                            (!ttsSiliconflowApiKey || !ttsSiliconflowVoice || !ttsSiliconflowModel)) ||
                          (ttsServiceType === 'mstts' && !ttsMsVoice)
                        }>
                        {t('settings.tts.test')}
                      </Button>
                    </Form.Item>
                  </Form>
                </SettingGroup>
              </div>
            )
          },
          {
            key: 'asr',
            label: (
              <span>
                <AudioOutlined /> {t('settings.asr.tab_title')}
              </span>
            ),
            children: <ASRSettings />
          },
          {
            key: 'voice_call',
            label: (
              <span>
                <PhoneOutlined /> {t('settings.voice_call.tab_title')}
              </span>
            ),
            children: <VoiceCallSettings />
          }
        ]}
      />
      <SettingHelpText style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5 }}>
        <span>{t('settings.voice.help')}</span>
        <a
          href="https://platform.openai.com/docs/guides/speech-to-text"
          className="link"
          target="_blank"
          rel="noopener noreferrer">
          {t('settings.voice.learn_more')}
        </a>
      </SettingHelpText>
    </SettingContainer>
  )
}

export default TTSSettings
