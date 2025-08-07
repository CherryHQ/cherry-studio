/**
 * 简单的错误测试脚本，在开发环境中使用
 * 使用方法：在浏览器控制台粘贴并运行
 */

// 等待页面完全加载和错误测试工具初始化
setTimeout(() => {
  if (typeof errorTest === 'undefined') {
    console.error('❌ 错误测试工具未找到。请确认：')
    console.log('1. 应用正在开发环境运行 (NODE_ENV=development)')
    console.log('2. 页面已完全加载')
    console.log('3. 错误处理系统已正确初始化')
    return
  }

  console.log('🔧 错误处理测试开始')
  console.log('可用的测试命令：')
  
  // 列出所有可用的测试
  errorTest.listErrorTests()
  
  console.log('\n🧪 快速测试：')
  console.log('运行以下命令来测试不同类型的错误：')
  
  const quickTests = [
    'errorTest.testJSError()',
    'errorTest.testPromiseRejection()',
    'errorTest.testReactError()',
    'errorTest.testResourceError()'
  ]
  
  quickTests.forEach(test => {
    console.log(`• ${test}`)
  })
  
  console.log('\n⚡ 或运行所有测试：')
  console.log('• errorTest.runAllTests()')
  
  console.log('\n📝 使用说明：')
  console.log('1. 打开浏览器开发者工具')
  console.log('2. 在控制台中输入上述命令')
  console.log('3. 观察错误处理系统的行为')
  console.log('4. 检查错误是否被正确捕获和记录')
  
}, 2000)