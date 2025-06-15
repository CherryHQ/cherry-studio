import { HStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import { getTTSProviderLogo, TTS_PROVIDER_CONFIG } from '@renderer/config/tts'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useTTS } from '@renderer/hooks/useTTS'
import { TTSProvider } from '@renderer/types/tts'
import { Avatar, Button, Flex, Input, Select, Slider, Switch, Tag } from 'antd'
import { Pause, Play, Search, Square, SquareArrowOutUpRight, Volume2 } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  SettingContainer,
  SettingDivider,
  SettingHelpLink,
  SettingHelpText,
  SettingHelpTextRow,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '.'

const TTSSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const tts = useTTS()

  // 本地状态
  const [searchText, setSearchText] = useState<string>('')
  const [selectedProvider, setSelectedProvider] = useState<TTSProvider | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPaused, setIsPaused] = useState(false)

  // 过滤供应商（优化：使用 useMemo 避免不必要的重新计算）
  const filteredProviders = useMemo(() => {
    if (!searchText.trim()) return tts.providers
    const lowerSearchText = searchText.toLowerCase()
    return tts.providers.filter((provider) => {
      const displayName = tts.getTTSProviderName(provider)
      return displayName.toLowerCase().includes(lowerSearchText)
    })
  }, [searchText, tts])

  // 初始化选中的供应商（优化：只在真正需要时初始化）
  useEffect(() => {
    if (tts.providers.length > 0 && !selectedProvider) {
      setSelectedProvider(tts.providers[0])
    }
  }, [tts.providers, selectedProvider])

  // 同步 selectedProvider 与 Redux 状态（优化：使用 useMemo 和更精确的比较）
  const currentProviderFromRedux = useMemo(() => {
    return selectedProvider ? tts.providers.find((p) => p.id === selectedProvider.id) : null
  }, [tts.providers, selectedProvider])

  useEffect(() => {
    if (
      currentProviderFromRedux &&
      selectedProvider &&
      JSON.stringify(currentProviderFromRedux) !== JSON.stringify(selectedProvider)
    ) {
      setSelectedProvider(currentProviderFromRedux)
    }
  }, [currentProviderFromRedux, selectedProvider])

  // 更新供应商设置（优化：移除日志）
  const updateProvider = useCallback(
    (updatedProvider: TTSProvider) => {
      tts.updateProvider(updatedProvider)
    },
    [tts]
  )

  // 获取可用语音（修复：支持所有 TTS Provider）
  const voicesLoadedRef = useRef<Set<string>>(new Set())

  const loadProviderVoices = useCallback(async () => {
    if (!selectedProvider) return

    const providerId = selectedProvider.id
    const config = TTS_PROVIDER_CONFIG[selectedProvider.type]

    // 只为支持语音选择的 Provider 加载语音
    if (!config.supportedFeatures.includes('voice')) {
      return
    }

    // 避免重复加载
    if (voicesLoadedRef.current.has(providerId)) {
      return
    }

    try {
      const voices = await tts.getVoices(providerId)
      if (voices.length > 0) {
        tts.updateProviderVoices(providerId, voices)
        voicesLoadedRef.current.add(providerId)
      }
    } catch (error) {
      console.error(`Failed to load voices for ${selectedProvider.type}:`, error)
    }
  }, [selectedProvider, tts])

  useEffect(() => {
    if (selectedProvider) {
      loadProviderVoices()

      // 为 Web Speech API 监听语音变化事件
      if (selectedProvider.type === 'web-speech' && 'speechSynthesis' in window) {
        const handleVoicesChanged = () => {
          // 重置加载状态，允许重新加载
          voicesLoadedRef.current.delete(selectedProvider.id)
          loadProviderVoices()
        }

        speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged)
        return () => {
          speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged)
        }
      }
    }
    return undefined
  }, [selectedProvider, loadProviderVoices])

  // 测试语音
  const handleTestSpeech = useCallback(async () => {
    if (!selectedProvider?.enabled) {
      return
    }

    if (isPlaying) {
      tts.stop()
      setIsPlaying(false)
      setIsPaused(false)
      return
    }

    try {
      const testText = t('settings.tts.test.text')
      setIsPlaying(true)
      setIsPaused(false)

      await tts.speak(testText, {
        voice: selectedProvider.settings.voice,
        rate: selectedProvider.settings.rate,
        pitch: selectedProvider.settings.pitch,
        volume: selectedProvider.settings.volume
      })

      setIsPlaying(false)
      setIsPaused(false)
    } catch (error) {
      console.error('TTS test failed:', error)
      setIsPlaying(false)
      setIsPaused(false)
    }
  }, [selectedProvider, isPlaying, tts, t])

  // 暂停/恢复
  const handlePauseResume = useCallback(() => {
    if (isPaused) {
      tts.resume()
      setIsPaused(false)
    } else {
      tts.pause()
      setIsPaused(true)
    }
  }, [isPaused, tts])

  // 优化的事件处理函数
  const handleProviderEnabledChange = useCallback(
    (enabled: boolean) => {
      if (!selectedProvider) return
      const updatedProvider = { ...selectedProvider, enabled } as TTSProvider
      updateProvider(updatedProvider)
      tts.setProviderEnabled(selectedProvider.id, enabled)
    },
    [selectedProvider, tts, updateProvider]
  )

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value)
  }, [])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setSearchText('')
    }
  }, [])

  const handleProviderSelect = useCallback((provider: TTSProvider) => {
    setSelectedProvider(provider)
  }, [])

  // 获取供应商头像
  const getProviderAvatar = useCallback((provider: TTSProvider) => {
    const logo = getTTSProviderLogo(provider.type)
    if (logo) {
      return <ProviderLogo size={25} shape="square" src={logo} />
    }
    return (
      <ProviderLogo size={25} shape="square" style={{ backgroundColor: '#1890ff', minWidth: 25 }}>
        <Volume2 size={14} color="white" />
      </ProviderLogo>
    )
  }, [])

  // 渲染供应商设置
  const renderProviderSettings = () => {
    if (!selectedProvider) {
      return (
        <SettingContainer theme={theme} style={{ background: 'var(--color-background)' }}>
          <SettingTitle>{t('settings.tts.title')}</SettingTitle>
          <SettingHelpText>{t('settings.tts.description')}</SettingHelpText>
        </SettingContainer>
      )
    }

    const config = TTS_PROVIDER_CONFIG[selectedProvider.type]

    const officialWebsite = config.websites?.official

    return (
      <SettingContainer theme={theme} style={{ background: 'var(--color-background)' }}>
        <SettingTitle>
          <Flex align="center" gap={5}>
            <span>{tts.getTTSProviderName(selectedProvider)}</span>
            {officialWebsite && (
              <a target="_blank" href={officialWebsite} style={{ display: 'flex' }}>
                <Button type="text" size="small" icon={<SquareArrowOutUpRight size={14} />} />
              </a>
            )}
          </Flex>
          <Switch checked={selectedProvider.enabled} onChange={handleProviderEnabledChange} />
        </SettingTitle>
        <SettingHelpText>{config.description}</SettingHelpText>

        <SettingDivider style={{ margin: '10px 0' }} />

        <SettingRow>
          <SettingRowTitle>{t('settings.tts.auto_play')}</SettingRowTitle>
          <Switch
            checked={selectedProvider.settings.autoPlay}
            onChange={(autoPlay) => {
              const updatedProvider = {
                ...selectedProvider,
                settings: { ...selectedProvider.settings, autoPlay }
              } as TTSProvider
              updateProvider(updatedProvider)
              tts.updateProviderSettings(selectedProvider.id, { autoPlay })
            }}
          />
        </SettingRow>
        <SettingHelpText>{t('settings.tts.auto_play.description')}</SettingHelpText>

        {/* 流式合成选项（仅支持的 Provider） */}
        {(config as any).supportsStreaming && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.streaming')}</SettingRowTitle>
              <Switch
                checked={selectedProvider.settings.streaming ?? false}
                onChange={(streaming) => {
                  const updatedProvider = {
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, streaming }
                  } as TTSProvider
                  updateProvider(updatedProvider)
                  tts.updateProviderSettings(selectedProvider.id, { streaming })
                }}
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.streaming.description')}</SettingHelpText>

            {/* 暂停功能设置（仅在启用流式时显示） */}
            {selectedProvider.settings.streaming && (
              <>
                <SettingRow>
                  <SettingRowTitle>{t('settings.tts.pause_support.title')}</SettingRowTitle>
                  <Switch
                    checked={selectedProvider.settings.pauseSupport ?? false}
                    onChange={(pauseSupport) => {
                      const updatedProvider = {
                        ...selectedProvider,
                        settings: { ...selectedProvider.settings, pauseSupport }
                      } as TTSProvider
                      updateProvider(updatedProvider)
                      tts.updateProviderSettings(selectedProvider.id, { pauseSupport })
                    }}
                  />
                </SettingRow>
                <SettingHelpText>{t('settings.tts.pause_support.description')}</SettingHelpText>
              </>
            )}
          </>
        )}

        {/* API Key 输入（如果需要） */}
        {config.requiresApiKey && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>
                {selectedProvider.type === 'tencentcloud' ? 'SecretId' : t('settings.provider.api_key')}
              </SettingRowTitle>
              <Input.Password
                style={{ width: 300 }}
                value={selectedProvider.apiKey || ''}
                placeholder={
                  selectedProvider.type === 'tencentcloud' ? '请输入腾讯云 SecretId' : t('settings.provider.api_key')
                }
                onChange={(e) => {
                  const updatedProvider = {
                    ...selectedProvider,
                    apiKey: e.target.value
                  } as TTSProvider
                  updateProvider(updatedProvider)
                  tts.setProviderApiKey(selectedProvider.id, e.target.value)
                }}
              />
            </SettingRow>
            {(config.websites as any)?.apiKey && (
              <SettingHelpTextRow style={{ justifyContent: 'space-between' }}>
                <HStack>
                  <SettingHelpLink target="_blank" href={(config.websites as any).apiKey}>
                    {t('settings.provider.get_api_key')}
                  </SettingHelpLink>
                </HStack>
                <SettingHelpText>
                  {selectedProvider.type === 'tencentcloud'
                    ? '腾讯云访问密钥 ID，用于身份验证。可在腾讯云控制台的访问管理页面获取。'
                    : t('settings.provider.api_key.tip')}
                </SettingHelpText>
              </SettingHelpTextRow>
            )}
          </>
        )}

        {/* 语音选择 */}
        {config.supportedFeatures.includes('voice') && selectedProvider.voices.length > 0 && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.voice')}</SettingRowTitle>
              <Select
                style={{ width: 300 }}
                value={selectedProvider.settings.voice}
                onChange={(voice) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, voice }
                  } as TTSProvider)
                }
                placeholder={t('settings.tts.voice.placeholder')}
                options={selectedProvider.voices.map((voice) => ({
                  label: `${voice.name} (${voice.lang})${voice.default ? ' - ' + t('settings.tts.voice.default') : ''}`,
                  value: voice.id
                }))}
              />
            </SettingRow>
          </>
        )}

        {/* 语速控制 */}
        {config.supportedFeatures.includes('rate') && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.rate')}</SettingRowTitle>
              <SliderContainer>
                <Slider
                  min={selectedProvider.type === 'openai' ? 0.25 : 0.1}
                  max={selectedProvider.type === 'openai' ? 4.0 : 2.0}
                  step={0.1}
                  value={selectedProvider.settings.rate}
                  onChange={(rate) =>
                    updateProvider({
                      ...selectedProvider,
                      settings: { ...selectedProvider.settings, rate }
                    } as TTSProvider)
                  }
                  style={{ width: 200 }}
                />
                <SliderValue>{selectedProvider.settings.rate.toFixed(1)}</SliderValue>
              </SliderContainer>
            </SettingRow>
            <SettingHelpText>
              {selectedProvider.type === 'openai'
                ? t('settings.tts.rate.description') + ' (0.25 - 4.0)'
                : t('settings.tts.rate.description')}
            </SettingHelpText>
          </>
        )}

        {/* 音调控制 */}
        {config.supportedFeatures.includes('pitch') && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.pitch')}</SettingRowTitle>
              <SliderContainer>
                <Slider
                  min={0.0}
                  max={2.0}
                  step={0.1}
                  value={selectedProvider.settings.pitch}
                  onChange={(pitch) =>
                    updateProvider({
                      ...selectedProvider,
                      settings: { ...selectedProvider.settings, pitch }
                    } as TTSProvider)
                  }
                  style={{ width: 200 }}
                />
                <SliderValue>{selectedProvider.settings.pitch.toFixed(1)}</SliderValue>
              </SliderContainer>
            </SettingRow>
            <SettingHelpText>{t('settings.tts.pitch.description')}</SettingHelpText>
          </>
        )}

        {/* 音量控制 */}
        {config.supportedFeatures.includes('volume') && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.volume')}</SettingRowTitle>
              <SliderContainer>
                <Slider
                  min={0.0}
                  max={1.0}
                  step={0.1}
                  value={selectedProvider.settings.volume}
                  onChange={(volume) =>
                    updateProvider({
                      ...selectedProvider,
                      settings: { ...selectedProvider.settings, volume }
                    } as TTSProvider)
                  }
                  style={{ width: 200 }}
                />
                <SliderValue>{Math.round(selectedProvider.settings.volume * 100)}%</SliderValue>
              </SliderContainer>
            </SettingRow>
            <SettingHelpText>{t('settings.tts.volume.description')}</SettingHelpText>
          </>
        )}

        {/* OpenAI TTS 特有参数 */}
        {selectedProvider.type === 'openai' && (
          <>
            {/* 模型选择 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.model')}</SettingRowTitle>
              <Select
                style={{ width: 300 }}
                value={selectedProvider.settings.model || 'tts-1'}
                onChange={(model) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, model }
                  } as TTSProvider)
                }
                options={[
                  { label: 'TTS-1 (Standard)', value: 'tts-1' },
                  { label: 'TTS-1-HD (High Quality)', value: 'tts-1-hd' }
                ]}
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.model.description')}</SettingHelpText>

            {/* 音频格式 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.format')}</SettingRowTitle>
              <Select
                style={{ width: 300 }}
                value={selectedProvider.settings.format || 'mp3'}
                onChange={(format) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, format }
                  } as TTSProvider)
                }
                options={[
                  { label: 'MP3', value: 'mp3' },
                  { label: 'Opus', value: 'opus' },
                  { label: 'AAC', value: 'aac' },
                  { label: 'FLAC', value: 'flac' },
                  { label: 'WAV', value: 'wav' },
                  { label: 'PCM', value: 'pcm' }
                ]}
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.format.description')}</SettingHelpText>
          </>
        )}

        {/* Azure Speech 特有参数 */}
        {selectedProvider.type === 'azure' && (
          <>
            {/* 区域设置 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.region')}</SettingRowTitle>
              <Select
                style={{ width: 300 }}
                value={selectedProvider.settings.region || 'eastus'}
                onChange={(region) => {
                  const updatedProvider = {
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, region }
                  } as TTSProvider
                  updateProvider(updatedProvider)
                  // 当区域改变时，自动更新 API Host
                  tts.setProviderApiHost(selectedProvider.id, `https://${region}.tts.speech.microsoft.com`)
                }}
                options={[
                  { label: 'Australia East', value: 'australiaeast' },
                  { label: 'Brazil South', value: 'brazilsouth' },
                  { label: 'Canada Central', value: 'canadacentral' },
                  { label: 'Central India', value: 'centralindia' },
                  { label: 'Central US', value: 'centralus' },
                  { label: 'East Asia', value: 'eastasia' },
                  { label: 'East US', value: 'eastus' },
                  { label: 'East US 2', value: 'eastus2' },
                  { label: 'France Central', value: 'francecentral' },
                  { label: 'Germany West Central', value: 'germanywestcentral' },
                  { label: 'Japan East', value: 'japaneast' },
                  { label: 'Japan West', value: 'japanwest' },
                  { label: 'Korea Central', value: 'koreacentral' },
                  { label: 'North Central US', value: 'northcentralus' },
                  { label: 'North Europe', value: 'northeurope' },
                  { label: 'Norway East', value: 'norwayeast' },
                  { label: 'Qatar Central', value: 'qatarcentral' },
                  { label: 'South Africa North', value: 'southafricanorth' },
                  { label: 'South Central US', value: 'southcentralus' },
                  { label: 'Southeast Asia', value: 'southeastasia' },
                  { label: 'Sweden Central', value: 'swedencentral' },
                  { label: 'Switzerland North', value: 'switzerlandnorth' },
                  { label: 'Switzerland West', value: 'switzerlandwest' },
                  { label: 'UAE North', value: 'uaenorth' },
                  { label: 'UK South', value: 'uksouth' },
                  { label: 'West Central US', value: 'westcentralus' },
                  { label: 'West Europe', value: 'westeurope' },
                  { label: 'West US', value: 'westus' },
                  { label: 'West US 2', value: 'westus2' },
                  { label: 'West US 3', value: 'westus3' }
                ]}
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.region.description')}</SettingHelpText>

            {/* API Host 配置 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.provider.api_host')}</SettingRowTitle>
              <Input
                style={{ width: 300 }}
                value={
                  selectedProvider.apiHost ||
                  `https://${selectedProvider.settings.region || 'eastus'}.tts.speech.microsoft.com`
                }
                placeholder="https://eastus.tts.speech.microsoft.com"
                onChange={(e) => {
                  const updatedProvider = {
                    ...selectedProvider,
                    apiHost: e.target.value
                  } as TTSProvider
                  updateProvider(updatedProvider)
                  tts.setProviderApiHost(selectedProvider.id, e.target.value)
                }}
              />
            </SettingRow>
            <SettingHelpText>
              {t('settings.provider.api_host.tip')} 格式: https://{'{'}
              {t('settings.tts.region')}
              {'}'}.tts.speech.microsoft.com
            </SettingHelpText>

            {/* 语音样式 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.speaking_style')}</SettingRowTitle>
              <Select
                style={{ width: 300 }}
                value={selectedProvider.settings.speaking_style || 'general'}
                onChange={(speaking_style) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, speaking_style }
                  } as TTSProvider)
                }
                options={[
                  { label: 'General', value: 'general' },
                  { label: 'Newscast', value: 'newscast' },
                  { label: 'Customerservice', value: 'customerservice' },
                  { label: 'Chat', value: 'chat' },
                  { label: 'Cheerful', value: 'cheerful' },
                  { label: 'Sad', value: 'sad' },
                  { label: 'Angry', value: 'angry' },
                  { label: 'Fearful', value: 'fearful' },
                  { label: 'Disgruntled', value: 'disgruntled' },
                  { label: 'Serious', value: 'serious' },
                  { label: 'Affectionate', value: 'affectionate' },
                  { label: 'Gentle', value: 'gentle' },
                  { label: 'Lyrical', value: 'lyrical' },
                  { label: 'Newscast-formal', value: 'newscast-formal' },
                  { label: 'Newscast-casual', value: 'newscast-casual' },
                  { label: 'Assistant', value: 'assistant' }
                ]}
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.speaking_style.description')}</SettingHelpText>

            {/* 语音角色 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.role')}</SettingRowTitle>
              <Select
                style={{ width: 300 }}
                value={selectedProvider.settings.role || 'default'}
                onChange={(role) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, role }
                  } as TTSProvider)
                }
                options={[
                  { label: 'Default', value: 'default' },
                  { label: 'Girl', value: 'Girl' },
                  { label: 'Boy', value: 'Boy' },
                  { label: 'YoungAdultFemale', value: 'YoungAdultFemale' },
                  { label: 'YoungAdultMale', value: 'YoungAdultMale' },
                  { label: 'OlderAdultFemale', value: 'OlderAdultFemale' },
                  { label: 'OlderAdultMale', value: 'OlderAdultMale' },
                  { label: 'SeniorFemale', value: 'SeniorFemale' },
                  { label: 'SeniorMale', value: 'SeniorMale' }
                ]}
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.role.description')}</SettingHelpText>
          </>
        )}

        {/* ElevenLabs 特有参数 */}
        {selectedProvider.type === 'elevenlabs' && (
          <>
            {/* 模型选择 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.model')}</SettingRowTitle>
              <Select
                style={{ width: 300 }}
                value={selectedProvider.settings.model || 'eleven_multilingual_v2'}
                onChange={(model) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, model }
                  } as TTSProvider)
                }
                options={[
                  { label: 'Eleven Multilingual v2', value: 'eleven_multilingual_v2' },
                  { label: 'Eleven Multilingual v1', value: 'eleven_multilingual_v1' },
                  { label: 'Eleven Monolingual v1', value: 'eleven_monolingual_v1' },
                  { label: 'Eleven English v1', value: 'eleven_english_v1' },
                  { label: 'Eleven Turbo v2', value: 'eleven_turbo_v2' }
                ]}
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.model.description')}</SettingHelpText>

            {/* 稳定性 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.stability')}</SettingRowTitle>
              <SliderContainer>
                <Slider
                  min={0.0}
                  max={1.0}
                  step={0.1}
                  value={selectedProvider.settings.stability ?? 0.5}
                  onChange={(stability) =>
                    updateProvider({
                      ...selectedProvider,
                      settings: { ...selectedProvider.settings, stability }
                    } as TTSProvider)
                  }
                  style={{ width: 200 }}
                />
                <SliderValue>{(selectedProvider.settings.stability ?? 0.5).toFixed(1)}</SliderValue>
              </SliderContainer>
            </SettingRow>
            <SettingHelpText>{t('settings.tts.stability.description')}</SettingHelpText>

            {/* 相似度增强 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.similarity_boost')}</SettingRowTitle>
              <SliderContainer>
                <Slider
                  min={0.0}
                  max={1.0}
                  step={0.1}
                  value={selectedProvider.settings.similarity_boost ?? 0.5}
                  onChange={(similarity_boost) =>
                    updateProvider({
                      ...selectedProvider,
                      settings: { ...selectedProvider.settings, similarity_boost }
                    } as TTSProvider)
                  }
                  style={{ width: 200 }}
                />
                <SliderValue>{(selectedProvider.settings.similarity_boost ?? 0.5).toFixed(1)}</SliderValue>
              </SliderContainer>
            </SettingRow>
            <SettingHelpText>{t('settings.tts.similarity_boost.description')}</SettingHelpText>

            {/* 风格 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.style')}</SettingRowTitle>
              <SliderContainer>
                <Slider
                  min={0.0}
                  max={1.0}
                  step={0.1}
                  value={selectedProvider.settings.style ?? 0.0}
                  onChange={(style) =>
                    updateProvider({
                      ...selectedProvider,
                      settings: { ...selectedProvider.settings, style }
                    } as TTSProvider)
                  }
                  style={{ width: 200 }}
                />
                <SliderValue>{(selectedProvider.settings.style ?? 0.0).toFixed(1)}</SliderValue>
              </SliderContainer>
            </SettingRow>
            <SettingHelpText>{t('settings.tts.style.description')}</SettingHelpText>

            {/* 扬声器增强 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.use_speaker_boost')}</SettingRowTitle>
              <Switch
                checked={selectedProvider.settings.use_speaker_boost ?? true}
                onChange={(use_speaker_boost) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, use_speaker_boost }
                  } as TTSProvider)
                }
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.use_speaker_boost.description')}</SettingHelpText>
          </>
        )}

        {/* SiliconFlow 特有参数 */}
        {selectedProvider.type === 'siliconflow' && (
          <>
            {/* 模型选择 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.model')}</SettingRowTitle>
              <Select
                style={{ width: 300 }}
                value={selectedProvider.settings.model || 'FunAudioLLM/CosyVoice2-0.5B'}
                onChange={(model) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, model }
                  } as TTSProvider)
                }
                options={[{ label: 'CosyVoice2-0.5B', value: 'FunAudioLLM/CosyVoice2-0.5B' }]}
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.model.description')}</SettingHelpText>

            {/* 音频格式 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.format')}</SettingRowTitle>
              <Select
                style={{ width: 300 }}
                value={selectedProvider.settings.format || 'mp3'}
                onChange={(format) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, format }
                  } as TTSProvider)
                }
                options={[
                  { label: 'MP3', value: 'mp3' },
                  { label: 'Opus', value: 'opus' },
                  { label: 'WAV', value: 'wav' },
                  { label: 'PCM', value: 'pcm' }
                ]}
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.format.description')}</SettingHelpText>

            {/* 采样率 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.sample_rate')}</SettingRowTitle>
              <Select
                style={{ width: 300 }}
                value={selectedProvider.settings.sample_rate || 44100}
                onChange={(sample_rate) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, sample_rate }
                  } as TTSProvider)
                }
                options={[
                  { label: '8000 Hz', value: 8000 },
                  { label: '16000 Hz', value: 16000 },
                  { label: '24000 Hz', value: 24000 },
                  { label: '32000 Hz', value: 32000 },
                  { label: '44100 Hz', value: 44100 },
                  { label: '48000 Hz', value: 48000 }
                ]}
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.sample_rate.description')}</SettingHelpText>
          </>
        )}

        {/* TencentCloud 特有参数 */}
        {selectedProvider.type === 'tencentcloud' && (
          <>
            {/* SecretKey */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.secretKey')}</SettingRowTitle>
              <Input
                style={{ width: 300 }}
                type="password"
                value={selectedProvider.settings.secretKey || ''}
                onChange={(e) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, secretKey: e.target.value }
                  } as TTSProvider)
                }
                placeholder="请输入腾讯云 SecretKey"
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.secretKey.description')}</SettingHelpText>

            {/* AppId */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>AppId</SettingRowTitle>
              <Input
                style={{ width: 300 }}
                type="number"
                value={(selectedProvider.settings as any).appId || ''}
                onChange={(e) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, appId: parseInt(e.target.value) || undefined }
                  } as TTSProvider)
                }
                placeholder="请输入腾讯云 AppId"
              />
            </SettingRow>
            <SettingHelpText>腾讯云应用 ID，可在腾讯云控制台的 API 密钥管理页面获取，流式合成必需</SettingHelpText>

            {/* 地域选择 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.region')}</SettingRowTitle>
              <Select
                style={{ width: 300 }}
                value={selectedProvider.settings.region || 'ap-beijing'}
                onChange={(region) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, region }
                  } as TTSProvider)
                }
                options={[
                  { label: '北京 (ap-beijing)', value: 'ap-beijing' },
                  { label: '上海 (ap-shanghai)', value: 'ap-shanghai' },
                  { label: '广州 (ap-guangzhou)', value: 'ap-guangzhou' },
                  { label: '成都 (ap-chengdu)', value: 'ap-chengdu' },
                  { label: '重庆 (ap-chongqing)', value: 'ap-chongqing' },
                  { label: '天津 (ap-tianjin)', value: 'ap-tianjin' },
                  { label: '深圳 (ap-shenzhen-fsi)', value: 'ap-shenzhen-fsi' },
                  { label: '香港 (ap-hongkong)', value: 'ap-hongkong' },
                  { label: '新加坡 (ap-singapore)', value: 'ap-singapore' },
                  { label: '东京 (ap-tokyo)', value: 'ap-tokyo' },
                  { label: '首尔 (ap-seoul)', value: 'ap-seoul' },
                  { label: '孟买 (ap-mumbai)', value: 'ap-mumbai' },
                  { label: '曼谷 (ap-bangkok)', value: 'ap-bangkok' },
                  { label: '弗吉尼亚 (na-ashburn)', value: 'na-ashburn' },
                  { label: '硅谷 (na-siliconvalley)', value: 'na-siliconvalley' },
                  { label: '多伦多 (na-toronto)', value: 'na-toronto' },
                  { label: '法兰克福 (eu-frankfurt)', value: 'eu-frankfurt' },
                  { label: '莫斯科 (eu-moscow)', value: 'eu-moscow' }
                ]}
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.region.tencent.description')}</SettingHelpText>

            {/* 采样率 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.sampleRate')}</SettingRowTitle>
              <Select
                style={{ width: 300 }}
                value={selectedProvider.settings.sampleRate || 16000}
                onChange={(sampleRate) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, sampleRate }
                  } as TTSProvider)
                }
                options={[
                  { label: '8000 Hz', value: 8000 },
                  { label: '16000 Hz', value: 16000 },
                  { label: '24000 Hz', value: 24000 }
                ]}
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.sampleRate.description')}</SettingHelpText>

            {/* 音频编码 */}
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.codec')}</SettingRowTitle>
              <Select
                style={{ width: 300 }}
                value={selectedProvider.settings.codec || 'wav'}
                onChange={(codec) =>
                  updateProvider({
                    ...selectedProvider,
                    settings: { ...selectedProvider.settings, codec }
                  } as TTSProvider)
                }
                options={[
                  { label: 'WAV', value: 'wav' },
                  { label: 'MP3', value: 'mp3' }
                ]}
              />
            </SettingRow>
            <SettingHelpText>{t('settings.tts.codec.description')}</SettingHelpText>
          </>
        )}

        {/* 测试语音（仅 Web Speech API） */}
        {selectedProvider.type === 'web-speech' && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.tts.test')}</SettingRowTitle>
              <HStack gap="8px">
                <Button
                  type="primary"
                  icon={isPlaying ? <Square size={16} /> : <Play size={16} />}
                  onClick={handleTestSpeech}>
                  {isPlaying ? t('settings.tts.test.stop') : t('settings.tts.test.play')}
                </Button>
                {isPlaying && (
                  <Button icon={isPaused ? <Play size={16} /> : <Pause size={16} />} onClick={handlePauseResume}>
                    {isPaused ? t('settings.tts.test.resume') : t('settings.tts.test.pause')}
                  </Button>
                )}
              </HStack>
            </SettingRow>
            <SettingHelpText>{t('settings.tts.test.description')}</SettingHelpText>
          </>
        )}

        {/* 文档和模型链接 */}
        {((config.websites as any)?.docs || (config.websites as any)?.models) && (
          <SettingHelpTextRow>
            <SettingHelpText>{t('settings.provider.docs_check')} </SettingHelpText>
            {(config.websites as any)?.docs && (
              <SettingHelpLink target="_blank" href={(config.websites as any).docs}>
                {tts.getTTSProviderName(selectedProvider) + ' '}
                {t('common.docs')}
              </SettingHelpLink>
            )}
            {(config.websites as any)?.docs && (config.websites as any)?.models && (
              <SettingHelpText>{t('common.and')}</SettingHelpText>
            )}
            {(config.websites as any)?.models && (
              <SettingHelpLink target="_blank" href={(config.websites as any).models}>
                {t('common.models')}
              </SettingHelpLink>
            )}
            <SettingHelpText>{t('settings.provider.docs_more_details')}</SettingHelpText>
          </SettingHelpTextRow>
        )}
      </SettingContainer>
    )
  }

  return (
    <Container className="selectable">
      <ProviderListContainer>
        <AddButtonWrapper>
          <Input
            type="text"
            placeholder={t('settings.provider.search')}
            value={searchText}
            style={{ borderRadius: 'var(--list-item-border-radius)', height: 35 }}
            suffix={<Search size={14} />}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            allowClear
          />
        </AddButtonWrapper>
        <Scrollbar>
          <ProviderList>
            {filteredProviders.map((provider) => (
              <ProviderListItem
                key={provider.id}
                className={provider.id === selectedProvider?.id ? 'active' : ''}
                onClick={() => handleProviderSelect(provider)}>
                {getProviderAvatar(provider)}
                <ProviderItemName className="text-nowrap">{tts.getTTSProviderName(provider)}</ProviderItemName>
                {provider.enabled && (
                  <Tag color="green" style={{ marginLeft: 'auto', marginRight: 0, borderRadius: 16 }}>
                    ON
                  </Tag>
                )}
              </ProviderListItem>
            ))}
          </ProviderList>
        </Scrollbar>
      </ProviderListContainer>

      {/* 右侧供应商设置 */}
      {renderProviderSettings()}
    </Container>
  )
}

// 样式组件
const Container = styled.div`
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
`

const ProviderListContainer = styled.div`
  display: flex;
  flex-direction: column;
  min-width: calc(var(--settings-width) + 10px);
  height: calc(100vh - var(--navbar-height));
  border-right: 0.5px solid var(--color-border);
`

const AddButtonWrapper = styled.div`
  height: 50px;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  padding: 10px 8px;
`

const ProviderList = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 8px;
  padding-right: 5px;
`

const ProviderListItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 5px 10px;
  width: 100%;
  cursor: pointer;
  border-radius: var(--list-item-border-radius);
  font-size: 14px;
  transition: all 0.2s ease-in-out;
  border: 0.5px solid transparent;

  &:hover {
    background: var(--color-background-soft);
  }

  &.active {
    background: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
    font-weight: bold !important;
  }
`

const ProviderLogo = styled(Avatar)`
  border: 0.5px solid var(--color-border);
`

const ProviderItemName = styled.div`
  margin-left: 10px;
  font-weight: 500;
`

const SliderContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const SliderValue = styled.span`
  min-width: 40px;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-2);
`

export default TTSSettings
