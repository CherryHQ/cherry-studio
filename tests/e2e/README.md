# E2E Testing Guide

本目录包含 Cherry Studio 的端到端 (E2E) 测试，使用 Playwright 测试 Electron 应用。

## 目录结构

```
tests/e2e/
├── README.md                 # 本文档
├── global-setup.ts           # 全局测试初始化
├── global-teardown.ts        # 全局测试清理
├── fixtures/
│   └── electron.fixture.ts   # Electron 应用启动 fixture
├── utils/
│   ├── electron-app.ts       # 应用启动辅助函数
│   ├── wait-helpers.ts       # 等待辅助函数
│   └── index.ts              # 工具导出
├── pages/                    # Page Object Model
│   ├── base.page.ts          # 基础页面对象类
│   ├── sidebar.page.ts       # 侧边栏导航
│   ├── home.page.ts          # 首页/聊天页
│   ├── settings.page.ts      # 设置页
│   ├── chat.page.ts          # 聊天交互
│   └── index.ts              # 页面对象导出
└── specs/                    # 测试用例
    ├── app-launch.spec.ts    # 应用启动测试
    ├── navigation.spec.ts    # 页面导航测试
    ├── settings/             # 设置相关测试
    │   └── general.spec.ts
    └── conversation/         # 对话相关测试
        └── basic-chat.spec.ts
```

---

## 运行测试

### 前置条件

1. 安装依赖：`yarn install`
2. 构建应用：`yarn build`

### 运行命令

```bash
# 运行所有 e2e 测试
yarn test:e2e

# 带可视化窗口运行（可以看到测试过程）
yarn test:e2e --headed

# 运行特定测试文件
yarn playwright test tests/e2e/specs/app-launch.spec.ts

# 运行匹配名称的测试
yarn playwright test -g "should launch"

# 调试模式（会暂停并打开调试器）
yarn playwright test --debug

# 使用 Playwright UI 模式
yarn playwright test --ui

# 查看测试报告
yarn playwright show-report
```

### 常见问题

**Q: 测试时看不到窗口？**
A: 默认是 headless 模式，使用 `--headed` 参数可看到窗口。

**Q: 测试失败，提示找不到元素？**
A:
1. 确保已运行 `yarn build` 构建最新代码
2. 检查选择器是否正确，UI 可能已更新

**Q: 测试超时？**
A: Electron 应用启动较慢，可在测试中增加超时时间：
```typescript
test.setTimeout(60000) // 60秒
```

---

## AI 助手指南：创建新测试用例

以下内容供 AI 助手（如 Claude、GPT）在创建新测试用例时参考。

### 基本原则

1. **使用 Page Object Model (POM)**：所有页面交互应通过 `pages/` 目录下的页面对象进行
2. **使用自定义 fixture**：从 `../fixtures/electron.fixture` 导入 `test` 和 `expect`
3. **等待策略**：使用 `utils/wait-helpers.ts` 中的等待函数，避免硬编码 `waitForTimeout`
4. **测试独立性**：每个测试应该独立运行，不依赖其他测试的状态

### 创建新测试文件

```typescript
// tests/e2e/specs/[feature]/[feature].spec.ts

import { test, expect } from '../../fixtures/electron.fixture'
import { SomePageObject } from '../../pages/some.page'
import { waitForAppReady } from '../../utils/wait-helpers'

test.describe('Feature Name', () => {
  let pageObject: SomePageObject

  test.beforeEach(async ({ mainWindow }) => {
    await waitForAppReady(mainWindow)
    pageObject = new SomePageObject(mainWindow)
  })

  test('should do something', async ({ mainWindow }) => {
    // 测试逻辑
  })
})
```

### 创建新页面对象

```typescript
// tests/e2e/pages/[feature].page.ts

import { Page, Locator } from '@playwright/test'
import { BasePage } from './base.page'

export class FeaturePage extends BasePage {
  // 定义页面元素定位器
  readonly someButton: Locator
  readonly someInput: Locator

  constructor(page: Page) {
    super(page)
    // 使用多种选择器策略，提高稳定性
    this.someButton = page.locator('[class*="SomeButton"], button:has-text("Some Text")')
    this.someInput = page.locator('input[placeholder*="placeholder"]')
  }

  // 页面操作方法
  async doSomething(): Promise<void> {
    await this.someButton.click()
  }

  // 状态检查方法
  async isSomethingVisible(): Promise<boolean> {
    return this.someButton.isVisible()
  }
}
```

### 选择器最佳实践

```typescript
// 优先级从高到低：

// 1. data-testid（最稳定，但需要在源码中添加）
page.locator('[data-testid="submit-button"]')

// 2. 语义化角色
page.locator('button[role="submit"]')
page.locator('[aria-label="Send message"]')

// 3. 类名模糊匹配（适应 CSS Modules / styled-components）
page.locator('[class*="SendButton"]')
page.locator('[class*="send-button"]')

// 4. 文本内容
page.locator('button:has-text("发送")')
page.locator('text=Submit')

// 5. 组合选择器（提高稳定性）
page.locator('[class*="ChatInput"] textarea, [class*="InputBar"] textarea')

// 避免使用：
// - 精确类名（容易因构建变化而失效）
// - 层级过深的选择器
// - 索引选择器（如 nth-child）除非必要
```

### 等待策略

```typescript
import { waitForAppReady, waitForNavigation, waitForModal } from '../../utils/wait-helpers'

// 等待应用就绪
await waitForAppReady(mainWindow)

// 等待导航完成（HashRouter）
await waitForNavigation(mainWindow, '/settings')

// 等待模态框出现
await waitForModal(mainWindow)

// 等待元素可见
await page.locator('.some-element').waitFor({ state: 'visible', timeout: 10000 })

// 等待元素消失
await page.locator('.loading').waitFor({ state: 'hidden' })

// 避免使用固定等待时间
// BAD: await page.waitForTimeout(3000)
// GOOD: await page.waitForSelector('.element', { state: 'visible' })
```

### 断言模式

```typescript
// 使用 Playwright 的自动重试断言
await expect(page.locator('.element')).toBeVisible()
await expect(page.locator('.element')).toHaveText('expected text')
await expect(page.locator('.element')).toHaveCount(3)

// 检查 URL（HashRouter）
await expect(page).toHaveURL(/.*#\/settings.*/)

// 软断言（不会立即失败）
await expect.soft(page.locator('.element')).toBeVisible()

// 自定义超时
await expect(page.locator('.slow-element')).toBeVisible({ timeout: 30000 })
```

### 处理 Electron 特性

```typescript
// 访问 Electron 主进程
const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]
  return win?.getBounds()
})

// 检查窗口状态
const isMaximized = await electronApp.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]
  return win?.isMaximized()
})

// 调用 IPC（通过 preload 暴露的 API）
const result = await mainWindow.evaluate(() => {
  return (window as any).api.someMethod()
})
```

### 测试文件命名规范

```
specs/
├── [feature].spec.ts           # 单文件测试
├── [feature]/
│   ├── [sub-feature].spec.ts   # 子功能测试
│   └── [another].spec.ts
```

示例：
- `app-launch.spec.ts` - 应用启动
- `navigation.spec.ts` - 页面导航
- `settings/general.spec.ts` - 通用设置
- `conversation/basic-chat.spec.ts` - 基础聊天

### 添加新页面对象后的清单

1. 在 `pages/` 目录创建 `[feature].page.ts`
2. 继承 `BasePage` 类
3. 在 `pages/index.ts` 中导出
4. 在对应的 spec 文件中导入使用

### 测试用例编写清单

- [ ] 使用自定义 fixture (`test`, `expect`)
- [ ] 在 `beforeEach` 中调用 `waitForAppReady`
- [ ] 使用 Page Object 进行页面交互
- [ ] 使用描述性的测试名称
- [ ] 添加适当的断言
- [ ] 处理可能的异步操作
- [ ] 考虑测试失败时的清理

### 调试技巧

```typescript
// 截图调试
await mainWindow.screenshot({ path: 'debug.png' })

// 打印页面 HTML
console.log(await mainWindow.content())

// 暂停测试进行调试
await mainWindow.pause()

// 打印元素数量
console.log(await page.locator('.element').count())
```

---

## 配置文件

主要配置在项目根目录的 `playwright.config.ts`：

- `testDir`: 测试目录 (`./tests/e2e/specs`)
- `timeout`: 测试超时 (60秒)
- `workers`: 并发数 (1，Electron 需要串行)
- `retries`: 重试次数 (CI 环境下为 2)

---

## 相关文档

- [Playwright 官方文档](https://playwright.dev/docs/intro)
- [Playwright Electron 测试](https://playwright.dev/docs/api/class-electron)
- [Page Object Model](https://playwright.dev/docs/pom)
