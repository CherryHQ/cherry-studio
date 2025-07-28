# 关于解决 Electron WebView 中 Cloudflare 验证问题的技术方案

## 1. 问题背景

在使用本应用内嵌的小程序（基于 Electron `<webview>` 标签）访问部分受 Cloudflare 保护的网站（如 Perplexity, Grok, Deepseek 等）时，会频繁遇到人机验证（如 hCaptcha, Turnstile）无法通过，页面卡在验证环节的问题。这严重影响了对这些外部服务的集成和使用体验。

## 2. 核心原因

经过分析，该问题的根源在于 Cloudflare 等现代网络安全服务具备高级的**浏览器指纹识别**能力。它们不仅仅检查单一的特征，而是通过分析大量浏览器环境数据点来判断访问者是真实用户还是自动化程序（Bot）。

Electron 的 `<webview>` 默认环境在多个方面与标准浏览器存在差异，从而被识别为“可疑”：

1.  **User-Agent 暴露身份**：默认的 User-Agent 包含 "Electron" 字符串，是机器流量最明显的标志。
2.  **JavaScript 环境特征**：
    *   `navigator.webdriver` 属性通常为 `true`。
    *   `window.chrome` 等浏览器特有的全局对象不完整或缺失。
    *   `navigator.plugins` 和 `navigator.mimeTypes` 列表为空，与真实浏览器不符。
3.  **硬件及渲染指纹**：可以通过 WebGL API 获取到真实的、可能与服务器环境相关的显卡信息，而非典型的消费级设备信息。
4.  **函数原生性检测**：可以通过 `Function.prototype.toString()` 方法检测出某些原生函数是否被代码修改过，从而识破伪装。
5.  **会话存储共享**：所有小程序默认共享同一个 `partition`，可能导致一个网站的负面标记影响到其他网站。

## 3. 最终解决方案

为了应对上述多维度的检测，我们采取了一套分层、纵深防御的综合伪装方案。

### 3.1. 更新 User-Agent

这是伪装的第一步。我们为 `<webview>` 标签强制指定了一个通用的、现代的桌面浏览器 User-Agent 字符串，覆盖了默认的 Electron UA。

**文件**: `src/renderer/src/components/MinApp/WebviewContainer.tsx`
**实现**:
```jsx
<webview
  useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  ...
/>
```

### 3.2. 会话隔离 (Session Isolation)

为了防止不同网站间的 Cookie 和缓存状态交叉污染，我们将 `<webview>` 的 `partition` 属性从静态共享值 `persist:webview` 修改为基于小程序 ID 的动态值。

**文件**: `src/renderer/src/components/MinApp/WebviewContainer.tsx`
**实现**:
```jsx
<webview
  partition={`persist:${appid}`}
  ...
/>
```

### 3.3. 使用 Preload 脚本进行深度环境伪装

这是整个方案的核心。我们利用了 `<webview>` 的 `preload` 属性，在网页内容加载之前注入一个伪装脚本 (`minapp.ts`)，从内部修改 JavaScript 环境，使其表现得像一个真实的浏览器。

**文件**: `src/preload/minapp.ts`
**构建配置**: `electron.vite.config.ts` (添加 `minapp.ts` 到 preload 入口)

**Preload 脚本的关键伪装点包括**：

-   **隐藏自动化特征**: 强制 `navigator.webdriver` 返回 `false`。
-   **模拟标准对象**: 确保 `window.chrome.runtime` 等对象存在。
-   **标准化环境信息**: 伪装 `navigator.language` 和 `navigator.languages` 为通用值。
-   **模拟插件列表**: 为 `navigator.plugins` 和 `navigator.mimeTypes` 提供了一套逼真的插件信息（如 PDF Viewer）。
-   **伪装 WebGL 信息**: 拦截 WebGL 的 `getParameter` 请求，返回一个常见的显卡供应商和渲染器名称，防止硬件指纹暴露。
-   **反检测函数修改**: 重写 `Function.prototype.toString` 方法，使其在被查询时返回 `[native code]`，隐藏我们对其他函数的修改痕迹。
-   **模拟权限 API**: 伪装 `navigator.permissions.query` 的行为，使其在响应通知等权限查询时返回标准浏览器的典型值。

## 4. 结论

单一的 User-Agent 修改已不足以应对现代化的网络安全防护。通过**“UA 伪装 + 会话隔离 + Preload 深度环境模拟”**这套组合拳，我们成功地构建了一个与真实浏览器环境高度相似的执行上下文，有效绕过了 Cloudflare 的多维度指纹检测，从根本上解决了验证失败的问题。
