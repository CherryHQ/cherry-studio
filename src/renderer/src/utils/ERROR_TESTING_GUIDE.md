# 全局错误处理测试指南

这个文档介绍如何在开发环境中测试全局错误处理系统的功能。

## 测试工具概览

错误测试工具只在开发环境（`NODE_ENV=development`）下激活，提供了一系列命令来触发不同类型的错误，验证全局错误处理系统是否正常工作。

## 使用方法

### 1. 启动开发环境

```bash
yarn dev
```

### 2. 打开浏览器开发者工具

- 按 `F12` 或右键选择"检查"
- 切换到 `Console` 标签

### 3. 使用错误测试命令

在控制台中输入以下命令来测试不同类型的错误：

## 可用的测试命令

### 基础JavaScript错误

```javascript
// 触发基础JavaScript错误
errorTest.testJSError()

// 触发类型错误（TypeError）
errorTest.testTypeError()

// 触发引用错误（ReferenceError）
errorTest.testReferenceError()

// 触发范围错误（RangeError）
errorTest.testRangeError()

// 触发语法错误（SyntaxError）
errorTest.testSyntaxError()
```

### 异步错误测试

```javascript
// 触发Promise拒绝错误
errorTest.testPromiseRejection()

// 触发异步操作错误
errorTest.testAsyncError()

// 触发超时错误
errorTest.testTimeoutError()
```

### React相关错误

```javascript
// 触发React组件错误（会被ErrorBoundary捕获）
errorTest.testReactError()

// 触发状态管理错误
errorTest.testStateError()
```

### 资源加载错误

```javascript
// 触发资源加载错误（如图片加载失败）
errorTest.testResourceError()

// 触发网络请求错误
errorTest.testNetworkError()
```

### 自定义错误

```javascript
// 触发自定义错误（包含额外上下文信息）
errorTest.testCustomError()

// 触发链式错误（包含错误原因）
errorTest.testChainedError()
```

### 工具命令

```javascript
// 列出所有可用的测试命令
errorTest.listErrorTests()

// 运行所有错误测试（会依次执行各种错误测试）
errorTest.runAllTests()

// 清理控制台输出
errorTest.clearErrors()
```

## 测试验证要点

### 1. 错误日志记录

每个错误都应该在以下位置记录：

- **浏览器控制台**：查看错误信息和堆栈跟踪
- **应用日志**：检查 `@logger` 是否正确记录了错误
- **主进程日志**：错误应该通过IPC发送到主进程

### 2. 错误边界处理

- **React错误**应该被 `GlobalErrorBoundary` 捕获
- **错误界面**应该显示用户友好的错误信息
- **开发环境**下应该显示详细的技术信息

### 3. 错误恢复

- 点击"重试"按钮应该能够重置错误状态
- 点击"刷新"按钮应该能够重新加载页面
- 应用应该能够从错误中恢复正常运行

### 4. 错误上报

验证错误是否正确发送到主进程：

```javascript
// 在主进程日志中查找错误报告
// 错误报告应包含：
// - 错误类型和消息
// - 完整的堆栈跟踪
// - 上下文信息（时间戳、URL、用户代理等）
// - 组件堆栈（React错误）
```

## 测试场景示例

### 场景1：基础错误处理测试

```javascript
// 1. 触发JavaScript错误
errorTest.testJSError()
// 验证：控制台显示错误，错误被记录到日志

// 2. 触发Promise拒绝
errorTest.testPromiseRejection()  
// 验证：unhandled promise rejection被捕获和记录
```

### 场景2：React错误边界测试

```javascript
// 1. 触发React组件错误
errorTest.testReactError()
// 验证：ErrorBoundary显示错误UI，用户可以重试

// 2. 点击"重试"按钮
// 验证：应用恢复正常状态
```

### 场景3：资源加载错误测试

```javascript
// 1. 触发资源加载错误
errorTest.testResourceError()
// 验证：网络错误被捕获，不影响应用正常运行
```

### 场景4：批量错误测试

```javascript
// 运行所有测试
errorTest.runAllTests()
// 验证：所有错误类型都被正确捕获和处理
```

## 预期行为

### 正常工作的错误处理系统应该：

1. **捕获所有类型的错误**
   - JavaScript运行时错误
   - Promise拒绝
   - React组件错误
   - 资源加载错误
   - 网络请求错误

2. **提供详细的错误信息**
   - 错误消息和类型
   - 完整的堆栈跟踪
   - 发生时间和上下文
   - 用户代理和URL信息

3. **用户友好的错误界面**
   - 清晰的错误说明
   - 恢复操作选项
   - 开发环境下的详细技术信息

4. **错误报告和日志记录**
   - 本地日志记录
   - 主进程错误报告
   - 结构化的错误数据

5. **不中断用户体验**
   - 错误不应导致应用完全崩溃
   - 提供重试和刷新选项
   - 保持应用其他功能正常

## 故障排除

如果错误测试工具不可用：

1. 确认是否在开发环境：`console.log(process.env.NODE_ENV)`
2. 确认是否正确初始化：查看控制台是否有初始化消息
3. 刷新页面重新初始化错误测试工具

如果某些错误没有被捕获：

1. 检查全局错误处理器是否正确初始化
2. 查看控制台错误信息
3. 检查ErrorBoundary是否正确包装了组件树

## 注意事项

- **仅在开发环境使用**：这些测试工具不会在生产环境中加载
- **测试后清理**：使用 `errorTest.clearErrors()` 清理控制台输出
- **监控性能**：频繁的错误测试可能影响开发环境性能
- **真实环境验证**：除了人工测试，还应该在真实使用场景中验证错误处理