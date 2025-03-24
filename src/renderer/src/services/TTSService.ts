/**
 * 渲染进程中的TTS服务
 * 负责调用主进程的TTS功能
 */
class TTSService {
  private isPlaying: boolean = false;

  constructor() {}

  /**
   * 播放文本
   * @param text 要播放的文本
   */
  async speak(text: string): Promise<boolean> {
    try {
      // 如果当前正在播放，先停止
      if (this.isPlaying) {
        this.stop();
      }
      
      console.log('请求主进程播放TTS:', text.substring(0, 30) + '...');
      
      // 使用IPC调用主进程的TTS功能
      const result = await window.electron.ipcRenderer.invoke('tts:speak', text);
      
      if (result?.success) {
        this.isPlaying = true;
        console.log('TTS播放成功');
        return true;
      } else {
        console.error('TTS播放失败:', result?.error || '未知错误');
        return false;
      }
    } catch (error) {
      console.error('TTS请求失败:', error);
      return false;
    }
  }

  /**
   * 停止播放
   */
  stop(): void {
    if (this.isPlaying) {
      console.log('请求主进程停止TTS播放');
      this.isPlaying = false;
      
      window.electron.ipcRenderer.invoke('tts:stop').catch(err => {
        console.error('停止TTS失败:', err);
      });
    }
  }

  /**
   * 获取可用的声音列表
   */
  async getVoices(): Promise<string[]> {
    try {
      return await window.electron.ipcRenderer.invoke('tts:getVoices') || [];
    } catch (error) {
      console.error('获取声音列表失败:', error);
      return [];
    }
  }

  /**
   * 检查TTS服务是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      const available = await window.electron.ipcRenderer.invoke('tts:isAvailable') || false;
      console.log('检查TTS服务可用性:', available);
      return available;
    } catch (error) {
      console.error('检查TTS服务可用性失败:', error);
      return false;
    }
  }
}

// 单例实例
export const ttsService = new TTSService();