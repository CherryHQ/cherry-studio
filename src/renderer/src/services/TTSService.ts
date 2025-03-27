/**
 * 渲染进程中的TTS服务
 * 负责调用主进程的TTS功能
 */
class TTSService {
  /**
   * 朗读文本
   * @param text 要朗读的文本
   * @returns 是否成功
   */
  async speak(text: string): Promise<boolean> {
    try {
      console.log('TTSService.speak 开始请求主进程TTS服务, 文本长度:', text.length);
      
      // 分段处理长文本，防止API请求超时
      if (text.length > 1000) {
        console.log('文本过长，进行分段处理');
        const segments = this.splitTextIntoSegments(text);
        
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          console.log(`正在处理第${i+1}/${segments.length}段文本`);
          
          // @ts-ignore - 调用主进程的tts.speak方法
          const result = await window.api.tts.speak(segment);
          
          if (!result || !result.success) {
            console.error('TTS合成失败:', result?.error || '未知错误');
            return false;
          }
        }
        return true;
      } else {
        // 短文本直接处理
        // @ts-ignore - 调用主进程的tts.speak方法
        const result = await window.api.tts.speak(text);
        
        if (!result || !result.success) {
          console.error('TTS合成失败:', result?.error || '未知错误');
          return false;
        }
        return true;
      }
    } catch (error) {
      console.error('调用TTS服务失败:', error);
      return false;
    }
  }
  
  /**
   * 停止播放
   */
  async stop() {
    try {
      // @ts-ignore - 调用主进程的tts.stop方法
      await window.api.tts.stop();
    } catch (error) {
      console.error('停止TTS播放失败:', error);
    }
  }
  
  /**
   * 获取可用的声音列表
   */
  async getVoices(): Promise<string[]> {
    try {
      // @ts-ignore - 调用主进程的tts.getVoices方法
      return await window.api.tts.getVoices();
    } catch (error) {
      console.error('获取TTS声音列表失败:', error);
      return [];
    }
  }
  
  /**
   * 将长文本分割成更小的片段
   * 尽量在句号、问号、感叹号等处分割
   */
  private splitTextIntoSegments(text: string, maxLength = 1000): string[] {
    const segments: string[] = [];
    let currentSegment = '';
    
    // 按句子分割
    const sentences = text.split(/(?<=[。？！.?!])/);
    
    for (const sentence of sentences) {
      // 如果当前句子加上现有段落超过最大长度，则开始新段落
      if (currentSegment.length + sentence.length > maxLength && currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = sentence;
      } else {
        currentSegment += sentence;
      }
    }
    
    // 添加最后一个段落
    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }
    
    return segments;
  }
}

// 单例实例
export const ttsService = new TTSService();