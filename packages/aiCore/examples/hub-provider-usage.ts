/**
 * Hub Provider 使用示例
 *
 * 演示如何使用简化后的Hub Provider功能来路由到多个底层provider
 */

import { createHubProvider, initializeProvider, providerRegistry } from '../src/index'

async function demonstrateHubProvider() {
  try {
    // 1. 初始化底层providers
    console.log('📦 初始化底层providers...')

    initializeProvider('openai', {
      apiKey: process.env.OPENAI_API_KEY || 'sk-test-key'
    })

    initializeProvider('anthropic', {
      apiKey: process.env.ANTHROPIC_API_KEY || 'sk-ant-test-key'
    })

    // 2. 创建Hub Provider（自动包含所有已初始化的providers）
    console.log('🌐 创建Hub Provider...')

    const aihubmixProvider = createHubProvider({
      hubId: 'aihubmix',
      debug: true
    })

    // 3. 注册Hub Provider
    providerRegistry.registerProvider('aihubmix', aihubmixProvider)

    console.log('✅ Hub Provider "aihubmix" 注册成功')

    // 4. 使用Hub Provider访问不同的模型
    console.log('\n🚀 使用Hub模型...')

    // 通过Hub路由到OpenAI
    const openaiModel = providerRegistry.languageModel('aihubmix:openai:gpt-4')
    console.log('✓ OpenAI模型已获取:', openaiModel.modelId)

    // 通过Hub路由到Anthropic
    const anthropicModel = providerRegistry.languageModel('aihubmix:anthropic:claude-3.5-sonnet')
    console.log('✓ Anthropic模型已获取:', anthropicModel.modelId)

    // 5. 演示错误处理
    console.log('\n❌ 演示错误处理...')

    try {
      // 尝试访问未初始化的provider
      providerRegistry.languageModel('aihubmix:google:gemini-pro')
    } catch (error) {
      console.log('预期错误:', error.message)
    }

    try {
      // 尝试使用错误的模型ID格式
      providerRegistry.languageModel('aihubmix:invalid-format')
    } catch (error) {
      console.log('预期错误:', error.message)
    }

    // 6. 多个Hub Provider示例
    console.log('\n🔄 创建多个Hub Provider...')

    const localHubProvider = createHubProvider({
      hubId: 'local-ai'
    })

    providerRegistry.registerProvider('local-ai', localHubProvider)
    console.log('✅ Hub Provider "local-ai" 注册成功')

    console.log('\n🎉 Hub Provider演示完成！')
  } catch (error) {
    console.error('💥 演示过程中发生错误:', error)
  }
}

// 演示简化的使用方式
function simplifiedUsageExample() {
  console.log('\n📝 简化使用示例:')
  console.log(`
// 1. 初始化providers
initializeProvider('openai', { apiKey: 'sk-xxx' })
initializeProvider('anthropic', { apiKey: 'sk-ant-xxx' })

// 2. 创建并注册Hub Provider
const hubProvider = createHubProvider({ hubId: 'aihubmix' })
providerRegistry.registerProvider('aihubmix', hubProvider)

// 3. 直接使用
const model1 = providerRegistry.languageModel('aihubmix:openai:gpt-4')
const model2 = providerRegistry.languageModel('aihubmix:anthropic:claude-3.5-sonnet')
`)
}

// 运行演示
if (require.main === module) {
  demonstrateHubProvider()
  simplifiedUsageExample()
}

export { demonstrateHubProvider, simplifiedUsageExample }
