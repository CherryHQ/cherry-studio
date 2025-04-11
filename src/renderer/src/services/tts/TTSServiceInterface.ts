/**
 * TTS服务接口
 * 所有TTS服务实现类都需要实现这个接口
 */
export interface TTSServiceInterface {
  /**
   * 合成语音
   * @param text 要合成的文本
   * @returns 返回音频Blob对象的Promise
   */
  synthesize(text: string): Promise<Blob>
}
