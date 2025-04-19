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

  /**
   * 流式合成语音 (可选实现)
   * @param text 要合成的文本
   * @param onStart 开始回调
   * @param onData 数据块回调
   * @param onEnd 结束回调
   * @param onError 错误回调
   * @returns 返回请求ID
   */
  synthesizeStream?(
    text: string,
    onStart: () => void,
    onData: (audioChunk: AudioBuffer) => void,
    onEnd: () => void,
    onError: (error: Error) => void
  ): Promise<string>
}
