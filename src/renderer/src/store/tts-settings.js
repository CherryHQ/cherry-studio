// TTS Redux状态和Action
// 将这些代码整合到src/renderer/src/store/settings.ts中

/*
在src/renderer/src/store/settings.ts中，需要添加的内容：

1. 在SettingsState接口中添加TTS相关状态：

export interface SettingsState {
  // 原有的state属性
  ...
  
  // TTS 设置
  ttsEnabled: boolean
  ttsType: 'openai' | 'edge'  // TTS类型
  ttsApiUrl: string
  ttsApiKey: string
  ttsModel: string
  ttsVoice: string
  ttsPlayerType: 'auto' | 'ffmpeg' | 'system'
  ttsEdgeRate: string
  ttsEdgeVolume: string
  ttsCustomModels: Array<{label?: string, value: string}>
  ttsCustomVoices: Array<{label?: string, value: string}>
}

2. 在initialState中添加TTS相关初始值：

const initialState: SettingsState = {
  // 原有的初始值
  ...
  
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
}

3. 在settingsSlice的reducers中添加TTS相关action：

reducers: {
  // 原有的reducers
  ...
  
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
}

4. 在export const {...} 导出部分添加TTS相关action：

export const {
  // 原有的exports
  ...
  
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
} = settingsSlice.actions
*/
