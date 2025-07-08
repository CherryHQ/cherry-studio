import { TTSProvider, TTSSpeakOptions } from '@renderer/types/tts'
import { useCallback, useState } from 'react'

import { useTTS } from './useTTS'

/**
 * 专门用于测试自建 TTS 服务的自定义 Hook。
 * 封装了测试文本、加载状态、错误信息以及发起测试的逻辑。
 *
 * @param providerToTest - 正在被测试的、可能未保存的 Provider 配置对象。
 * @returns 包含测试状态和操作函数的对象。
 */
export function useSelfHostTTSTest(providerToTest: TTSProvider | null) {
  const tts = useTTS()

  // --- State ---
  const [testText, setTestText] = useState('你好，欢迎使用 Cherry Studio。今天过得怎么样吗？')
  const [isTesting, setIsTesting] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // --- Callbacks ---

  /**
   * 发起测试请求。
   */
  const startTest = useCallback(async () => {
    // 必须有 Provider 并且 Provider 必须是启用的
    if (!providerToTest || !providerToTest.enabled) {
      return
    }

    setIsTesting(true)
    setError(null)

    try {
      // 关键：将用户当前在 UI 上编辑的、最新的 providerToTest 对象
      // 作为 providerOverride 参数传递给 speak 方法。
      const options: Partial<TTSSpeakOptions> = {
        // 使用 providerToTest 中的设置为准
        voice: providerToTest.settings.voice,
        rate: providerToTest.settings.rate,
        pitch: providerToTest.settings.pitch,
        volume: providerToTest.settings.volume,
        // 明确传递覆盖对象
        providerOverride: providerToTest
      }

      await tts.speak(testText, options)
    } catch (e) {
      setError(e as Error)
    } finally {
      setIsTesting(false)
    }
  }, [tts, testText, providerToTest])

  /**
   * 停止当前的测试播放。
   */
  const stopTest = useCallback(() => {
    tts.stop()
    setIsTesting(false)
  }, [tts])

  return {
    testText,
    setTestText,
    isTesting,
    error,
    startTest,
    stopTest
  }
}
