// TTS预加载模块API
// 将这些代码整合到src/preload/index.ts中

/*
在src/preload/index.ts中，找到api对象定义，
添加tts相关API：

// 在api对象中添加
tts: {
  speak: (text: string) => ipcRenderer.invoke('tts:speak', text),
  stop: () => ipcRenderer.invoke('tts:stop'),
  getVoices: () => ipcRenderer.invoke('tts:getVoices'),
  isAvailable: () => ipcRenderer.invoke('tts:isAvailable'),
  fetchAvailableOptions: () => ipcRenderer.invoke('tts:fetchAvailableOptions')
},

这些API将在渲染进程中通过window.api.tts访问
*/

// API定义
const ttsApi = {
  // 播放文本语音
  speak: (text) => ipcRenderer.invoke('tts:speak', text),
  
  // 停止播放
  stop: () => ipcRenderer.invoke('tts:stop'),
  
  // 获取可用的声音列表
  getVoices: () => ipcRenderer.invoke('tts:getVoices'),
  
  // 检查TTS服务是否可用
  isAvailable: () => ipcRenderer.invoke('tts:isAvailable'),
  
  // 获取可用的TTS选项（模型和声音）
  fetchAvailableOptions: () => ipcRenderer.invoke('tts:fetchAvailableOptions')
};
