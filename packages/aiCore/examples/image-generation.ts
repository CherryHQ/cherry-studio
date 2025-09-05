/**
 * Image Generation Example
 * 演示如何使用 aiCore 的文生图功能
 */

import { createExecutor, generateImage } from '../src/index'

async function main() {
  // 方式1: 使用执行器实例
  console.log('📸 创建 OpenAI 图像生成执行器...')
  const executor = createExecutor('openai', {
    apiKey: process.env.OPENAI_API_KEY!
  })

  try {
    console.log('🎨 使用执行器生成图像...')
    const result1 = await executor.generateImage('dall-e-3', {
      prompt: 'A futuristic cityscape at sunset with flying cars',
      size: '1024x1024',
      n: 1
    })

    console.log('✅ 图像生成成功!')
    console.log('📊 结果:', {
      imagesCount: result1.images.length,
      mediaType: result1.image.mediaType,
      hasBase64: !!result1.image.base64,
      providerMetadata: result1.providerMetadata
    })
  } catch (error) {
    console.error('❌ 执行器生成失败:', error)
  }

  // 方式2: 使用直接调用 API
  try {
    console.log('🎨 使用直接 API 生成图像...')
    const result2 = await generateImage('openai', { apiKey: process.env.OPENAI_API_KEY! }, 'dall-e-3', {
      prompt: 'A magical forest with glowing mushrooms and fairy lights',
      aspectRatio: '16:9',
      providerOptions: {
        openai: {
          quality: 'hd',
          style: 'vivid'
        }
      }
    })

    console.log('✅ 直接 API 生成成功!')
    console.log('📊 结果:', {
      imagesCount: result2.images.length,
      mediaType: result2.image.mediaType,
      hasBase64: !!result2.image.base64
    })
  } catch (error) {
    console.error('❌ 直接 API 生成失败:', error)
  }

  // 方式3: 支持其他提供商 (Google Imagen)
  if (process.env.GOOGLE_API_KEY) {
    try {
      console.log('🎨 使用 Google Imagen 生成图像...')
      const googleExecutor = createExecutor('google', {
        apiKey: process.env.GOOGLE_API_KEY!
      })

      const result3 = await googleExecutor.generateImage('imagen-3.0-generate-002', {
        prompt: 'A serene mountain lake at dawn with mist rising from the water',
        aspectRatio: '1:1'
      })

      console.log('✅ Google Imagen 生成成功!')
      console.log('📊 结果:', {
        imagesCount: result3.images.length,
        mediaType: result3.image.mediaType,
        hasBase64: !!result3.image.base64
      })
    } catch (error) {
      console.error('❌ Google Imagen 生成失败:', error)
    }
  }

  // 方式4: 支持插件系统
  const pluginExample = async () => {
    console.log('🔌 演示插件系统...')

    // 创建一个示例插件，用于修改提示词
    const promptEnhancerPlugin = {
      name: 'prompt-enhancer',
      transformParams: async (params: any) => {
        console.log('🔧 插件: 增强提示词...')
        return {
          ...params,
          prompt: `${params.prompt}, highly detailed, cinematic lighting, 4K resolution`
        }
      },
      transformResult: async (result: any) => {
        console.log('🔧 插件: 处理结果...')
        return {
          ...result,
          enhanced: true
        }
      }
    }

    const executorWithPlugin = createExecutor(
      'openai',
      {
        apiKey: process.env.OPENAI_API_KEY!
      },
      [promptEnhancerPlugin]
    )

    try {
      const result4 = await executorWithPlugin.generateImage('dall-e-3', {
        prompt: 'A cute robot playing in a garden'
      })

      console.log('✅ 插件系统生成成功!')
      console.log('📊 结果:', {
        imagesCount: result4.images.length,
        enhanced: (result4 as any).enhanced,
        mediaType: result4.image.mediaType
      })
    } catch (error) {
      console.error('❌ 插件系统生成失败:', error)
    }
  }

  await pluginExample()
}

// 错误处理演示
async function errorHandlingExample() {
  console.log('⚠️  演示错误处理...')

  try {
    const executor = createExecutor('openai', {
      apiKey: 'invalid-key'
    })

    await executor.generateImage('dall-e-3', {
      prompt: 'Test image'
    })
  } catch (error: any) {
    console.log('✅ 成功捕获错误:', error.constructor.name)
    console.log('📋 错误信息:', error.message)
    console.log('🏷️  提供商ID:', error.providerId)
    console.log('🏷️  模型ID:', error.modelId)
  }
}

// 运行示例
if (require.main === module) {
  main()
    .then(() => {
      console.log('🎉 所有示例完成!')
      return errorHandlingExample()
    })
    .then(() => {
      console.log('🎯 示例程序结束')
      process.exit(0)
    })
    .catch((error) => {
      console.error('💥 程序执行出错:', error)
      process.exit(1)
    })
}
