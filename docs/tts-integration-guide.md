# TTS功能集成指南

本文档提供了将TTS（文本转语音）功能集成到Cherry Studio应用程序的详细说明。

## 已添加文件

1. `src/main/services/TTSService.ts` - 主进程TTS服务
2. `src/renderer/src/services/TTSService.ts` - 渲染进程TTS服务
3. `src/renderer/src/pages/settings/TTSSettings.tsx` - TTS设置页面
4. 其他支持文件 - IPC处理、预加载API和Redux状态

## 集成步骤

### 1. IPC处理程序

在`src/main/ipc.ts`中添加以下内容：

```typescript
// 在import部分添加
import TTSService from './services/TTSService'

// 在文件开头添加ttsService实例
const ttsService = new TTSService()

// 在registerIpc函数中添加
  // TTS
  ipcMain.handle('tts:speak', (_, text) => {
    console.log('主进程接收到TTS请求:', text.substring(0, 50) + '...');
    return ttsService.speak(text);
  })
  ipcMain.handle('tts:stop', () => ttsService.stop())
  ipcMain.handle('tts:getVoices', () => ttsService.getVoices())
  ipcMain.handle('tts:isAvailable', () => {
    const available = ttsService.isAvailable();
    console.log('TTS服务可用性检查:', available);
    return available;
  })
  ipcMain.handle('tts:fetchAvailableOptions', async () => {
    console.log('主进程尝试获取TTS可用选项');
    const result = await ttsService.fetchAvailableOptions();
    console.log('获取TTS可用选项结果:', 
      result.success ? '成功' : '失败', 
      result.models ? `获取到${result.models.length}个模型` : '');
    return result;
  })
```

### 2. 预加载API

在`src/preload/index.ts`中添加：

```typescript
// 在api对象中添加
tts: {
  speak: (text: string) => ipcRenderer.invoke('tts:speak', text),
  stop: () => ipcRenderer.invoke('tts:stop'),
  getVoices: () => ipcRenderer.invoke('tts:getVoices'),
  isAvailable: () => ipcRenderer.invoke('tts:isAvailable'),
  fetchAvailableOptions: () => ipcRenderer.invoke('tts:fetchAvailableOptions')
},
```

### 3. Redux状态

在`src/renderer/src/store/settings.ts`中添加：

```typescript
// 在SettingsState接口中添加
  // TTS 设置
  ttsEnabled: boolean
  ttsType: 'openai' | 'edge'  
  ttsApiUrl: string
  ttsApiKey: string
  ttsModel: string
  ttsVoice: string
  ttsPlayerType: 'auto' | 'ffmpeg' | 'system'
  ttsEdgeRate: string
  ttsEdgeVolume: string
  ttsCustomModels: Array<{label?: string, value: string}>
  ttsCustomVoices: Array<{label?: string, value: string}>
```

```typescript
// 在initialState中添加
  // TTS 设置
  ttsEnabled: false, 
  ttsType: 'openai',
  ttsApiUrl: 'https://api.openai.com/v1/audio/speech',
  ttsApiKey: '',
  ttsModel: 'tts-1',
  ttsVoice: 'alloy',
  ttsPlayerType: 'auto',
  ttsEdgeRate: '+0%',
  ttsEdgeVolume: '+0%',
  ttsCustomModels: [],
  ttsCustomVoices: []
```

```typescript
// 在reducers中添加
  // TTS相关设置
  setTtsEnabled: (state, action: PayloadAction<boolean>) => {
    state.ttsEnabled = action.payload
  },
  setTtsType: (state, action: PayloadAction<'openai' | 'edge'>) => {
    state.ttsType = action.payload
  },
  setTtsApiUrl: (state, action: PayloadAction<string>) => {
    state.ttsApiUrl = action.payload
  },
  setTtsApiKey: (state, action: PayloadAction<string>) => {
    state.ttsApiKey = action.payload
  },
  setTtsModel: (state, action: PayloadAction<string>) => {
    state.ttsModel = action.payload
  },
  setTtsVoice: (state, action: PayloadAction<string>) => {
    state.ttsVoice = action.payload
  },
  setTtsPlayerType: (state, action: PayloadAction<'auto' | 'ffmpeg' | 'system'>) => {
    state.ttsPlayerType = action.payload
  },
  setTtsEdgeRate: (state, action: PayloadAction<string>) => {
    state.ttsEdgeRate = action.payload
  },
  setTtsEdgeVolume: (state, action: PayloadAction<string>) => {
    state.ttsEdgeVolume = action.payload
  },
  setTtsCustomModels: (state, action: PayloadAction<Array<{label?: string, value: string}>>) => {
    state.ttsCustomModels = action.payload
  },
  setTtsCustomVoices: (state, action: PayloadAction<Array<{label?: string, value: string}>>) => {
    state.ttsCustomVoices = action.payload
  }
```

```typescript
// 在导出部分添加
  // TTS actions
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
```

### 4. 添加国际化支持

在语言文件中添加TTS相关翻译。

### 5. 在设置页面添加TTS入口

根据项目设置页面的实现方式，添加TTS设置页面入口。

## 使用方法

```typescript
import { ttsService } from '@renderer/services/TTSService'

// 播放文本
await ttsService.speak('要朗读的文本')

// 停止播放
ttsService.stop()

// 检查TTS是否可用
const available = await ttsService.isAvailable()
```

## 注意事项

1. OpenAI TTS需要有效的API密钥才能使用
2. Edge TTS需要安装edge-tts包（已在依赖中）
3. FFPlay播放需要系统安装ffmpeg（如未安装会自动使用系统默认播放器）

## 本地化支持

TTS功能支持中文和英文，可根据需要扩展其他语言支持。
