import React, { useState } from 'react';
import { Button, Tooltip, message } from 'antd';
import { SoundOutlined, LoadingOutlined } from '@ant-design/icons';
import { ttsService } from '@renderer/services/TTSService';
import { useSettings } from '@renderer/hooks/useSettings';

interface TTSButtonProps {
  text: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
  tooltip?: string;
}

/**
 * 文本朗读按钮组件
 * 在任何需要提供TTS功能的地方使用此组件
 */
const TTSButton: React.FC<TTSButtonProps> = ({ 
  text, 
  size = 'middle',
  style,
  tooltip = '朗读文本'
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { ttsEnabled } = useSettings();

  const handleSpeak = async () => {
    if (isPlaying) {
      // 如果正在播放，则停止
      ttsService.stop();
      setIsPlaying(false);
      return;
    }
    
    if (!text) {
      message.warning('没有可朗读的文本');
      return;
    }
    
    setIsLoading(true);
    
    try {
      // 检查TTS服务是否可用
      const available = await ttsService.isAvailable();
      if (!available) {
        message.error('TTS服务不可用，请在设置中配置');
        return;
      }
      
      // 播放文本
      const result = await ttsService.speak(text);
      
      if (result) {
        setIsPlaying(true);
      } else {
        message.error('文本朗读失败');
      }
    } catch (error) {
      console.error('TTS错误:', error);
      message.error('文本朗读出错');
    } finally {
      setIsLoading(false);
    }
  };

  // 如果TTS未启用，则不显示按钮
  if (!ttsEnabled) {
    return null;
  }

  return (
    <Tooltip title={tooltip}>
      <Button
        icon={isLoading ? <LoadingOutlined /> : <SoundOutlined />}
        onClick={handleSpeak}
        type={isPlaying ? 'primary' : 'default'}
        size={size}
        style={style}
      />
    </Tooltip>
  );
};

export default TTSButton;
