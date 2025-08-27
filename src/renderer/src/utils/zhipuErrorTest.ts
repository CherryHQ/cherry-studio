/**
 * 智谱错误测试工具
 * 使用方法：
 * 1. 在浏览器控制台中运行
 * 2. 选择智谱模型
 * 3. 发送消息测试错误
 */

export const ZhipuErrorTest = {
  /**
   * 测试API Key未配置错误
   */
  testNoApiKey() {
    localStorage.setItem('test_zhipu_error', 'no_api_key')
  },

  /**
   * 测试余额不足错误
   */
  testInsufficientBalance() {
    localStorage.setItem('test_zhipu_error', 'insufficient_balance')
  },

  /**
   * 测试免费配额用尽错误
   */
  testQuotaExceeded() {
    localStorage.setItem('test_zhipu_error', 'quota_exceeded')
  },

  /**
   * 清除测试模式
   */
  clearTest() {
    localStorage.removeItem('test_zhipu_error')
  },

  /**
   * 显示当前测试状态
   */
  getStatus() {
    const testError = localStorage.getItem('test_zhipu_error')
    if (testError) {
      return `🔧 当前测试模式：${testError}`
    } else {
      return '🔧 当前无测试模式'
    }
  },

  /**
   * 测试翻译是否正常工作
   */
  testTranslation() {
    try {
      // 尝试直接访问翻译
      const i18n = require('i18next')

      // 检查翻译是否存在
      const noApiKeyExists = i18n.exists('error.zhipu.no_api_key')
      const insufficientBalanceExists = i18n.exists('error.zhipu.insufficient_balance')
      const quotaExceededExists = i18n.exists('error.zhipu.quota_exceeded')

      return {
        noApiKeyExists,
        insufficientBalanceExists,
        quotaExceededExists
      }
    } catch (error) {
      return { error: '翻译测试失败' }
    }
  },

  /**
   * 检查当前语言和翻译状态
   */
  checkLanguage() {
    try {
      const i18n = require('i18next')

      // 检查中文翻译
      const zhCN = i18n.options.resources['zh-CN']?.translation?.error?.zhipu

      // 检查英文翻译
      const enUS = i18n.options.resources['en-US']?.translation?.error?.zhipu

      // 测试翻译键
      const noApiKeyExists = i18n.exists('error.zhipu.no_api_key')
      const noApiKeyValue = i18n.t('error.zhipu.no_api_key')

      return {
        currentLanguage: i18n.language,
        localStorageLanguage: localStorage.getItem('language'),
        navigatorLanguage: navigator.language,
        availableLanguages: Object.keys(i18n.options.resources),
        zhCN,
        enUS,
        noApiKeyExists,
        noApiKeyValue
      }
    } catch (error) {
      return { error: '语言检查失败' }
    }
  },

  /**
   * 显示所有可用的测试命令
   */
  help() {
    return `
🔧 智谱错误测试工具使用说明：

1. 设置测试模式：
   ZhipuErrorTest.testNoApiKey()        // 测试API Key未配置
   ZhipuErrorTest.testInsufficientBalance()  // 测试余额不足
   ZhipuErrorTest.testQuotaExceeded()   // 测试配额用尽

2. 查看状态：
   ZhipuErrorTest.getStatus()           // 查看当前测试状态

3. 测试翻译：
   ZhipuErrorTest.testTranslation()     // 测试翻译是否正常

4. 清除测试：
   ZhipuErrorTest.clearTest()           // 清除测试模式

5. 显示帮助：
   ZhipuErrorTest.help()                // 显示此帮助信息

💡 使用步骤：
1. 运行测试命令设置错误类型
2. 选择智谱模型（如GLM-4.5）
3. 发送消息
4. 查看错误提示和可点击链接
5. 测试完成后清除测试模式
    `
  }
}

// 将测试工具添加到全局对象，方便在控制台中使用
if (typeof window !== 'undefined') {
  ;(window as any).ZhipuErrorTest = ZhipuErrorTest
}
