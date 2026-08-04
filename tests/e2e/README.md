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
│   ├── wait-helpers.ts       # 等待辅助函数
│   ├── ui-locator.ts         # data-ui contract locator
│   └── index.ts              # 工具导出
└── specs/                    # 测试用例
    └── app-launch.spec.ts    # 应用启动边界测试
```

---

## 运行测试

### 前置条件

1. 安装依赖：`pnpm install`
2. 构建应用：`pnpm build`

### 运行命令

```bash
# 运行所有 e2e 测试
pnpm test:e2e

# 带可视化窗口运行（可以看到测试过程）
pnpm test:e2e --headed

# 运行特定测试文件
pnpm playwright test tests/e2e/specs/app-launch.spec.ts

# 运行匹配名称的测试
pnpm playwright test -g "reasonable size"

# 调试模式（会暂停并打开调试器）
pnpm playwright test --debug

# 使用 Playwright UI 模式
pnpm playwright test --ui

# 查看测试报告
pnpm playwright show-report
```

## 编写 E2E 测试

测试设计和审查统一遵守[前端测试规范](../../docs/references/testing/frontend-testing.md)。本目录只提供
Electron E2E 基础设施：

- 从 `fixtures/electron.fixture.ts` 导入 `test`、`expect`、`electronApp` 和 `mainWindow`。
- 使用 `utils/ui-locator.ts` 定位
  [UI Semantic Contract](../../docs/references/ui-semantic-contract.md)中的稳定应用边界。
- 运行参数以根目录 `playwright.config.ts` 为准。

新增 E2E 应围绕跨进程的完整用户结果，直接使用稳定的语义定位器和可观察条件。

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
