# TTS功能使用示例

本文档提供了几种在Cherry Studio应用中使用TTS功能的示例代码和集成方案。

## 基本用法

### 在渲染进程中直接使用TTS服务

```typescript
import { ttsService } from '@renderer/services/TTSService';

// 简单朗读文本
async function speakText(text: string) {
  try {
    const result = await ttsService.speak(text);
    if (!result) {
      console.error('TTS失败');
    }
  } catch (error) {
    console.error('TTS错误:', error);
  }
}

// 使用带错误处理的朗读
async function speakWithErrorHandling(text: string) {
  // 检查TTS服务是否可用
  const available = await ttsService.isAvailable();
  if (!available) {
    console.warn('TTS服务不可用，请在设置中配置');
    return false;
  }
  
  try {
    const result = await ttsService.speak(text);
    return result;
  } catch (error) {
    console.error('TTS错误:', error);
    return false;
  }
}

// 停止当前朗读
function stopSpeaking() {
  ttsService.stop();
}
```

## 在React组件中集成

### 聊天消息组件

```tsx
import React from 'react';
import { Button, message } from 'antd';
import { SoundOutlined } from '@ant-design/icons';
import { ttsService } from '@renderer/services/TTSService';
import { useSettings } from '@renderer/hooks/useSettings';

const ChatMessage = ({ content, sender }) => {
  const [isPlaying, setIsPlaying] = React.useState(false);
  const { ttsEnabled } = useSettings();
  
  const handleSpeak = async () => {
    if (isPlaying) {
      ttsService.stop();
      setIsPlaying(false);
      return;
    }
    
    try {
      const result = await ttsService.speak(content);
      setIsPlaying(result);
      
      // 监听播放完成
      setTimeout(() => {
        setIsPlaying(false);
      }, 1000 * content.length / 20); // 粗略估计播放时间
    } catch (error) {
      message.error('朗读失败');
    }
  };
  
  return (
    <div className="message">
      <div className="message-header">
        <span>{sender}</span>
        {ttsEnabled && (
          <Button 
            type="text" 
            icon={<SoundOutlined />} 
            size="small"
            onClick={handleSpeak}
          />
        )}
      </div>
      <div className="message-content">{content}</div>
    </div>
  );
};
```

### 使用TTSButton组件

```tsx
import React from 'react';
import TTSButton from '@renderer/components/TTSButton';

const DocumentViewer = ({ document }) => {
  return (
    <div className="document-viewer">
      <div className="document-header">
        <h1>{document.title}</h1>
        <TTSButton text={document.content} tooltip="朗读全文" />
      </div>
      <div className="document-content">{document.content}</div>
    </div>
  );
};
```

## 高级用法

### 分段朗读长文本

```typescript
const MAX_SEGMENT_LENGTH = 500; // 每段最大字符数

async function speakLongText(text: string) {
  // 按句号、问号、感叹号、分号、冒号分割
  const segments = text.split(/([。？！；：.?!;:])/g);
  const mergedSegments = [];
  
  // 合并小段为合适长度的段落
  let currentSegment = '';
  for (let i = 0; i < segments.length; i++) {
    if (currentSegment.length + segments[i].length > MAX_SEGMENT_LENGTH) {
      mergedSegments.push(currentSegment);
      currentSegment = segments[i];
    } else {
      currentSegment += segments[i];
    }
  }
  if (currentSegment.length > 0) {
    mergedSegments.push(currentSegment);
  }
  
  // 顺序朗读各段
  for (const segment of mergedSegments) {
    await ttsService.speak(segment);
  }
}
```

### 在消息收到后自动朗读

```typescript
import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { ttsService } from '@renderer/services/TTSService';

function useAutoTTS() {
  const { messages, currentMessage } = useSelector(state => state.chat);
  const { ttsEnabled, ttsAutoRead } = useSelector(state => state.settings);
  
  useEffect(() => {
    // 只有在启用了TTS和自动朗读设置时才执行
    if (!ttsEnabled || !ttsAutoRead || !currentMessage) return;
    
    // 只朗读AI的回复
    if (currentMessage.role === 'assistant') {
      ttsService.speak(currentMessage.content);
    }
    
    // 组件卸载时停止朗读
    return () => {
      ttsService.stop();
    };
  }, [currentMessage, ttsEnabled, ttsAutoRead]);
}
```

## 集成测试

以下是测试TTS功能的简单代码：

```typescript
async function testTTS() {
  console.log('测试TTS功能...');
  
  // 1. 检查TTS服务是否可用
  const available = await ttsService.isAvailable();
  console.log('TTS服务可用:', available);
  if (!available) return;
  
  // 2. 获取可用声音列表
  const voices = await ttsService.getVoices();
  console.log('可用声音:', voices);
  
  // 3. 获取API选项
  const options = await ttsService.fetchAvailableOptions();
  console.log('可用选项:', options);
  
  // 4. 测试播放
  const testText = "这是一段测试文本，用于验证TTS功能是否正常工作。";
  console.log('播放测试文本...');
  const result = await ttsService.speak(testText);
  console.log('播放结果:', result);
  
  // 5. 3秒后停止播放
  setTimeout(() => {
    console.log('停止播放...');
    ttsService.stop();
  }, 3000);
}
```

## 性能考虑

- 对于大文本，考虑分段播放以减少延迟
- 避免在UI渲染过程中进行TTS操作，可能导致卡顿
- 考虑添加缓存机制，避免重复生成相同内容的语音
- 监控TTS API的使用量，特别是使用OpenAI TTS时（API调用有成本）
