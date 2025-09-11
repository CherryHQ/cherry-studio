/**
 * AI SDK 参数转换模块 - 统一入口
 *
 * 此模块已重构，功能分拆到以下子模块：
 * - modelParameters.ts: 基础参数处理 (温度、TopP、超时)
 * - modelCapabilities.ts: 模型能力检查 (PDF、图片、文件支持)
 * - fileProcessor.ts: 文件处理逻辑 (转换、上传)
 * - messageConverter.ts: 消息转换核心 (单个消息转换)
 * - parameterBuilder.ts: 参数构建器 (最终参数组装)
 */

// 基础参数处理
export { getTimeout } from './modelParameters'

// 文件处理
export { extractFileContent } from './fileProcessor'

// 消息转换
export { convertMessagesToSdkMessages, convertMessageToSdkParam } from './messageConverter'

// 参数构建 (主要API)
export { buildGenerateTextParams, buildStreamTextParams } from './parameterBuilder'
