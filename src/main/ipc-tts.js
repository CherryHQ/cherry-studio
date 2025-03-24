// TTS IPC处理程序
// 将这些代码整合到src/main/ipc.ts中

// 导入TTSService
import TTSService from './services/TTSService'

// 初始化TTS服务
const ttsService = new TTSService()

// 注册TTS相关的IPC处理程序
export function registerTTSHandlers(ipcMain) {
  // 文本转语音
  ipcMain.handle('tts:speak', (_, text) => {
    console.log('主进程接收到TTS请求:', text.substring(0, 50) + '...');
    return ttsService.speak(text);
  })
  
  // 停止播放
  ipcMain.handle('tts:stop', () => ttsService.stop())
  
  // 获取可用声音列表
  ipcMain.handle('tts:getVoices', () => ttsService.getVoices())
  
  // 检查TTS服务可用性
  ipcMain.handle('tts:isAvailable', () => {
    const available = ttsService.isAvailable();
    console.log('TTS服务可用性检查:', available);
    return available;
  })
  
  // 获取可用的TTS选项（模型和声音）
  ipcMain.handle('tts:fetchAvailableOptions', async () => {
    console.log('主进程尝试获取TTS可用选项');
    const result = await ttsService.fetchAvailableOptions();
    console.log('获取TTS可用选项结果:', 
      result.success ? '成功' : '失败', 
      result.models ? `获取到${result.models.length}个模型` : '');
    return result;
  })
}

/*
在src/main/ipc.ts中，找到registerIpc函数，
在适当位置添加ttsService初始化和TTS相关的IPC处理程序：

// 在import部分添加
import TTSService from './services/TTSService'

// 在文件上方添加ttsService实例化
const ttsService = new TTSService()

// 在registerIpc函数内部添加TTS相关的IPC处理程序
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
*/
