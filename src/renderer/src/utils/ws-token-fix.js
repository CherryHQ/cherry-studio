/**
 * 此文件用于修复开发环境中的 __WS_TOKEN__ 未定义错误
 * 这是一个临时解决方案，仅用于开发环境
 */

// 在全局范围定义__WS_TOKEN__变量
if (typeof window !== 'undefined' && typeof __WS_TOKEN__ === 'undefined') {
  window.__WS_TOKEN__ = 'development-ws-token-placeholder';
  console.log('已添加临时 __WS_TOKEN__ 以解决开发环境错误');
}

export default {};
