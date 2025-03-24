import { PlusOutlined, SoundOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { 
  setTtsEnabled, 
  setTtsType,
  setTtsApiUrl, 
  setTtsApiKey, 
  setTtsModel, 
  setTtsVoice,
  setTtsPlayerType,
  setTtsEdgeRate,
  setTtsEdgeVolume,
  setTtsCustomModels,
  setTtsCustomVoices
} from '@renderer/store/settings'
import { 
  Button, 
  Input, 
  Select, 
  Switch, 
  message,
  Modal,
  Form
} from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { 
  SettingContainer, 
  SettingDivider, 
  SettingGroup, 
  SettingHelpText, 
  SettingHelpTextRow, 
  SettingRow, 
  SettingRowTitle, 
  SettingSubtitle, 
  SettingTitle 
} from '.'

// 定义选项类型
interface OptionType {
  label: string;
  value: string;
}

// 将自定义选项转换为Select组件需要的格式
const formatOptions = (
  customOptions: Array<{label?: string, value: string}> | undefined
): OptionType[] => {
  return (customOptions || []).map(item => ({ 
    label: item.label || item.value, 
    value: item.value 
  }));
};

const TTSSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { 
    ttsEnabled, 
    ttsType,
    ttsApiUrl, 
    ttsApiKey, 
    ttsModel, 
    ttsVoice,
    ttsPlayerType,
    ttsEdgeRate,
    ttsEdgeVolume,
    ttsCustomModels,
    ttsCustomVoices
  } = useSettings()

  const [apiChecking, setApiChecking] = useState(false)
  const [testText, setTestText] = useState('这是一段测试文本。')
  
  // 获取自定义选项
  const modelOptions = formatOptions(ttsCustomModels);
  const voiceOptions = formatOptions(ttsCustomVoices);
  
  // 添加自定义模型对话框
  const [modelModalVisible, setModelModalVisible] = useState(false)
  const [modelForm] = Form.useForm()
  
  // 添加自定义音色对话框
  const [voiceModalVisible, setVoiceModalVisible] = useState(false)
  const [voiceForm] = Form.useForm()

  // API选项获取状态
  const [isFetchingOptions, setIsFetchingOptions] = useState(false);
  
  // 尝试获取可用选项
  const fetchAvailableOptions = async () => {
    if (!ttsEnabled) return;
    
    setIsFetchingOptions(true);
    try {
      const result = await window.api.tts.fetchAvailableOptions();
      if (result?.success) {
        // 处理模型列表
        if (result.models && result.models.length > 0) {
          const newModels = result.models.map(modelId => ({
            label: modelId,
            value: modelId
          }));
          
          dispatch(setTtsCustomModels(newModels));
          message.success('已获取到' + newModels.length + '个TTS模型');
        }
        
        // 处理音色列表
        if (result.voices && result.voices.length > 0) {
          const newVoices = result.voices.map(voiceId => ({
            label: voiceId,
            value: voiceId
          }));
          
          dispatch(setTtsCustomVoices(newVoices));
          message.success('已获取到' + newVoices.length + '个音色');
        }
      } else if (result?.error) {
        message.warning('获取API选项失败: ' + result.error);
      }
    } catch (error: any) {
      console.error('获取可用选项错误:', error);
    } finally {
      setIsFetchingOptions(false);
    }
  };

  useEffect(() => {
    // 将设置同步到主进程
    window.api.config.set('ttsEnabled', ttsEnabled);
    window.api.config.set('ttsType', ttsType);
    window.api.config.set('ttsApiUrl', ttsApiUrl);
    window.api.config.set('ttsApiKey', ttsApiKey);
    window.api.config.set('ttsModel', ttsModel);
    window.api.config.set('ttsVoice', ttsVoice);
    window.api.config.set('ttsEdgeRate', ttsEdgeRate);
    window.api.config.set('ttsEdgeVolume', ttsEdgeVolume);

    // 获取API选项
    if (ttsEnabled) {
      fetchAvailableOptions();
    }
  }, [ttsEnabled, ttsType, ttsApiUrl, ttsApiKey, ttsModel, ttsVoice, ttsEdgeRate, ttsEdgeVolume]);

  // 检查 TTS 是否可用
  const checkApi = async () => {
    setApiChecking(true)
    try {
      // 使用主进程的TTS服务播放测试语音
      const result = await window.electron.ipcRenderer.invoke('tts:speak', testText);
      
      if (result?.success) {
        message.success(t('settings.tts.check_success'));
      } else {
        message.error(`${t('settings.tts.check_failed')}: ${result?.error || '未知错误'}`);
      }
    } catch (error: any) {
      message.error(`${t('settings.tts.check_failed')}: ${error.message}`);
    } finally {
      setApiChecking(false);
    }
  }

  const handleReset = () => {
    dispatch(setTtsApiUrl('https://api.openai.com/v1/audio/speech'))
  }

  const handleEnableTTS = (checked: boolean) => {
    dispatch(setTtsEnabled(checked));
    window.api.config.set('ttsEnabled', checked);
  }

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setTtsApiKey(e.target.value));
    window.api.config.set('ttsApiKey', e.target.value);
  }

  const handleApiUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setTtsApiUrl(e.target.value));
    window.api.config.set('ttsApiUrl', e.target.value);
  }

  const handleModelChange = (value: string) => {
    dispatch(setTtsModel(value));
    window.api.config.set('ttsModel', value);
  }

  const handleVoiceChange = (value: string) => {
    dispatch(setTtsVoice(value));
    window.api.config.set('ttsVoice', value);
  }

  const handleTtsTypeChange = (value: string) => {
    dispatch(setTtsType(value as 'openai' | 'edge'));
    window.api.config.set('ttsType', value);
    fetchAvailableOptions();
  }

  const handlePlayerTypeChange = (value: string) => {
    dispatch(setTtsPlayerType(value as 'auto' | 'ffmpeg' | 'system'));
    window.api.config.set('ttsPlayerType', value);
  }
  
  const handleEdgeRateChange = (value: string) => {
    dispatch(setTtsEdgeRate(value));
    window.api.config.set('ttsEdgeRate', value);
  }
  
  const handleEdgeVolumeChange = (value: string) => {
    dispatch(setTtsEdgeVolume(value));
    window.api.config.set('ttsEdgeVolume', value);
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>
          <SoundOutlined style={{ marginRight: 8 }} />
          {t('settings.tts.title')}
        </SettingTitle>
        <SettingDivider />
        
        <SettingRow>
          <SettingRowTitle>{t('settings.tts.enable')}</SettingRowTitle>
          <Switch 
            checked={ttsEnabled} 
            onChange={handleEnableTTS} 
          />
        </SettingRow>
        
        <SettingSubtitle style={{ marginTop: 10 }}>TTS引擎类型</SettingSubtitle>
        <Select
          value={ttsType}
          onChange={handleTtsTypeChange}
          style={{ width: '100%', marginTop: 5, marginBottom: 10 }}
          options={[
            { label: 'OpenAI TTS (需要API密钥)', value: 'openai' },
            { label: 'Microsoft Edge TTS (免费使用)', value: 'edge' }
          ]}
        />
        <SettingHelpTextRow>
          <SettingHelpText>
            选择TTS引擎类型：OpenAI TTS需要API密钥，Edge TTS不需要密钥且拥有更多语音选项。
          </SettingHelpText>
        </SettingHelpTextRow>

        <SettingDivider />
        
        {/* OpenAI TTS 相关设置 */}
        {ttsType === 'openai' && (
          <>
            <SettingSubtitle>{t('settings.tts.api_key')}</SettingSubtitle>
            <Input.Password 
              value={ttsApiKey}
              onChange={handleApiKeyChange}
              placeholder={t('settings.tts.api_key_placeholder')}
              style={{ marginTop: 5, marginBottom: 10 }}
            />
            {isFetchingOptions && <div style={{ marginTop: 5 }}>正在获取可用的模型和音色...</div>}

            <SettingSubtitle>{t('settings.tts.api_url')}</SettingSubtitle>
            <HStack gap={8}>
              <Input 
                value={ttsApiUrl}
                onChange={handleApiUrlChange}
                placeholder={t('settings.tts.api_url_placeholder')}
                style={{ flex: 1, marginTop: 5, marginBottom: 10 }}
              />
              <Button danger onClick={handleReset}>
                {t('settings.provider.api.url.reset')}
              </Button>
            </HStack>
          </>
        )}
        
        {/* Edge TTS 相关设置 */}
        {ttsType === 'edge' && (
          <>
            <SettingSubtitle>语速调整</SettingSubtitle>
            <Select
              value={ttsEdgeRate}
              onChange={handleEdgeRateChange}
              style={{ width: '100%', marginTop: 5, marginBottom: 10 }}
              options={[
                { label: '极慢 (-50%)', value: '-50%' },
                { label: '较慢 (-25%)', value: '-25%' },
                { label: '正常 (0%)', value: '+0%' },
                { label: '较快 (+25%)', value: '+25%' },
                { label: '极快 (+50%)', value: '+50%' }
              ]}
            />
            
            <SettingSubtitle>音量调整</SettingSubtitle>
            <Select
              value={ttsEdgeVolume}
              onChange={handleEdgeVolumeChange}
              style={{ width: '100%', marginTop: 5, marginBottom: 10 }}
              options={[
                { label: '很轻 (-50%)', value: '-50%' },
                { label: '较轻 (-25%)', value: '-25%' },
                { label: '正常 (0%)', value: '+0%' },
                { label: '较大 (+25%)', value: '+25%' },
                { label: '很大 (+50%)', value: '+50%' }
              ]}
            />
          </>
        )}

        <SettingDivider />

        <SettingSubtitle>{t('settings.tts.model')}</SettingSubtitle>
        <HStack gap={8} style={{ marginTop: 5, marginBottom: 10 }}>
          <Select
            value={ttsModel}
            onChange={handleModelChange}
            options={modelOptions}
            style={{ flex: 1 }}
            loading={isFetchingOptions}
          />
          <Button 
            icon={<PlusOutlined />} 
            onClick={() => setModelModalVisible(true)}
            title="添加自定义模型"
          />
        </HStack>

        <SettingSubtitle>{t('settings.tts.voice')}</SettingSubtitle>
        <HStack gap={8} style={{ marginTop: 5, marginBottom: 10 }}>
          <Select
            value={ttsVoice}
            onChange={handleVoiceChange}
            options={voiceOptions}
            style={{ flex: 1 }}
          />
          <Button 
            icon={<PlusOutlined />} 
            onClick={() => setVoiceModalVisible(true)}
            title="添加自定义音色"
          />
        </HStack>

        <SettingSubtitle>播放器类型</SettingSubtitle>
        <Select
          value={ttsPlayerType}
          onChange={handlePlayerTypeChange}
          style={{ width: '100%', marginTop: 5, marginBottom: 10 }}
          options={[
            { label: '自动选择 (优先使用ffplay)', value: 'auto' },
            { label: '强制使用ffplay', value: 'ffmpeg' },
            { label: '使用系统默认播放器', value: 'system' }
          ]}
        />

        <SettingDivider />
        
        <SettingSubtitle>{t('settings.tts.test')}</SettingSubtitle>
        <Input 
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder={t('settings.tts.test_placeholder')}
          style={{ marginTop: 5, marginBottom: 10 }}
        />
        <Button 
          type="primary" 
          onClick={checkApi}
          loading={apiChecking}
          disabled={!ttsEnabled}
        >
          {t('settings.tts.test_button')}
        </Button>
      </SettingGroup>
      
      {/* 添加自定义模型对话框 */}
      <Modal
        title="添加自定义模型"
        open={modelModalVisible}
        onOk={() => {
          modelForm.validateFields().then(values => {
            const newModel = {
              label: values.label || values.value,
              value: values.value
            }
            
            // 检查是否已存在
            const existingIndex = (ttsCustomModels || []).findIndex(model => model.value === values.value)
            if (existingIndex >= 0) {
              // 更新现有模型
              const newCustomModels = [...(ttsCustomModels || [])]
              newCustomModels[existingIndex] = newModel
              dispatch(setTtsCustomModels(newCustomModels))
            } else {
              // 添加新模型
              const newCustomModels = [...(ttsCustomModels || []), newModel]
              dispatch(setTtsCustomModels(newCustomModels))
            }
            
            setModelModalVisible(false)
            modelForm.resetFields()
            message.success('自定义模型添加成功')
          })
        }}
        onCancel={() => {
          setModelModalVisible(false)
          modelForm.resetFields()
        }}
      >
        <Form form={modelForm} layout="vertical">
          <Form.Item
            name="value"
            label="模型ID"
            rules={[{ required: true, message: '请输入模型ID' }]}
          >
            <Input placeholder="例如: tts-1-turbo" />
          </Form.Item>
          <Form.Item
            name="label"
            label="模型名称"
          >
            <Input placeholder="例如: TTS-1 Turbo" />
          </Form.Item>
        </Form>
      </Modal>
      
      {/* 添加自定义音色对话框 */}
      <Modal
        title="添加自定义音色"
        open={voiceModalVisible}
        onOk={() => {
          voiceForm.validateFields().then(values => {
            // 添加新的自定义音色
            const newVoice = {
              label: values.label || values.value,
              value: values.value
            }
            
            // 检查是否已存在
            const existingIndex = (ttsCustomVoices || []).findIndex(voice => voice.value === values.value)
            if (existingIndex >= 0) {
              // 更新现有音色
              const newCustomVoices = [...(ttsCustomVoices || [])]
              newCustomVoices[existingIndex] = newVoice
              dispatch(setTtsCustomVoices(newCustomVoices))
            } else {
              // 添加新音色
              const newCustomVoices = [...(ttsCustomVoices || []), newVoice]
              dispatch(setTtsCustomVoices(newCustomVoices))
            }
            
            setVoiceModalVisible(false)
            voiceForm.resetFields()
            message.success('自定义音色添加成功')
          })
        }}
        onCancel={() => {
          setVoiceModalVisible(false)
          voiceForm.resetFields()
        }}
      >
        <Form form={voiceForm} layout="vertical">
          <Form.Item
            name="value"
            label="音色ID"
            rules={[{ required: true, message: '请输入音色ID' }]}
          >
            <Input placeholder="例如: custom-voice" />
          </Form.Item>
          <Form.Item
            name="label"
            label="音色名称"
          >
            <Input placeholder="例如: 自定义音色" />
          </Form.Item>
        </Form>
      </Modal>
    </SettingContainer>
  )
}

export default TTSSettings