# Cherry Studio v2 — E2E 测试通用规范

本目录是 **Cherry Studio v2 功能的端到端测试**，面向用 **agent-browser（通过 CDP 驱动 Electron 渲染进程）** 的手动 / 智能体驱动测试方式。本 README 是**跨功能的通用规范**（怎么测）；每个功能域的用例放在各自子目录下。

> 核心约束：
> - **不使用 Playwright**，不写入 `tests/e2e/` 下的 POM 代码。
> - **不修改项目源码**（不新增 `data-testid`、不加测试 hook）。定位优先用「可见中文文案 + role/aria」，必要时用渲染进程 console 执行 `window.api.*` 做断言与数据准备 / 清理。
> - 测试产物（计划、记录、截图）都放在本 `.sessions/e2e/` 目录内（该目录被 `.gitignore` 忽略）。

## 目录结构

```
.sessions/e2e/
├── README.md          # 本文档：跨功能通用规范（测试方式 / 启动 / 定位 / 记录约定）
├── knowledge/         # 知识库 v2 功能域
│   ├── e2e.yaml       # ★ 可执行测试文档（agent 按 cases 跑，含已验证的精确步骤）
│   ├── test-plan.md   # 完整功能测试用例（按功能域分组，prose 版）
│   └── reference.md   # 附录：数据模型 / preload API / HTTP 网关 / i18n 文案 / 真实 testid / 供应商矩阵
└── painting/          # 绘图（Paintings）功能域
    └── e2e.yaml       # ★ 可执行测试文档
```

> 复跑某功能测试看其目录下 `e2e.yaml`（`status: validated` 的用例步骤已实测精确）；prose 细节查该域 `test-plan.md`，稳定事实查 `reference.md`。
> **新增一个功能域**：在本目录下建子目录（如 `chat/`、`translate/`），放各自的 `e2e.yaml`（必要时加 `test-plan.md` / `reference.md`），遵循本 README 的通用约定。各功能域的模型 / 数据前置、真实 testid、文案表写进该域自己的 `reference.md`。

---

## 一、环境准备

### 1. 构建 / 启动方式

本项目是 Electron 应用。agent-browser 通过 **CDP（Chrome DevTools Protocol）** 连接渲染进程窗口来驱动 UI。

> 已就绪：本分支已合入 `feat(preboot): support multi-instance dev userData suffix`（移植自 CherryHQ/cherry-studio#15731）。`pnpm debug` 现在会经 `dotenv` 加载 `.env`，并以 `--remote-debugging-port=9222` 暴露 CDP。

```bash
pnpm install            # Node ≥22, pnpm 10.27.0
# 隔离的独立用户数据目录 + CDP 端口 9222
MAIN_VITE_USER_DATA_DEV_SUFFIX=DevE2E pnpm debug
```

- `pnpm debug` = `dotenv electron-vite -- --inspect --sourcemap --remote-debugging-port=9222`，渲染进程 CDP 监听 `http://127.0.0.1:9222`。
- `MAIN_VITE_USER_DATA_DEV_SUFFIX=DevE2E` 让本次实例使用独立的 `userData`（默认目录 + 后缀），与日常开发数据、其它测试实例互不污染，并各自持有独立的单实例锁。留空 / 仅空白时回退为默认后缀 `Dev`。

> 提示：现有 `cherry-pr-test` skill 已实现「切到分支 → 以 debug 模式起 Electron → 通过 CDP 跑交互式 UI 测试」，可直接复用其启动 / 连接逻辑。

### 2. 并行 / 隔离实例

每条用例都应在**干净环境**下运行。两种做法：

1. **独立 profile**：用不同后缀起多个实例，数据完全隔离。`debug` 脚本里 `--remote-debugging-port=9222` 是写死的，**同一时刻 9222 只能被一个实例占用**；同机并行多个实例时需改用 `dev` 起并手动追加不同端口，或分时运行。单实例隔离测试用上面方式即可。
2. **同一实例内自清理**：每条用例前后用渲染进程 console 调用对应 `window.api.*` 删除残留数据（具体 API 见各功能域 `reference.md`）。

> 各功能域的**模型 / 数据前置条件**见该域 `reference.md` / `test-plan.md`（如知识库需 embedding 模型并能成功 `fetchDimensions`；绘图需在「模型服务」配好可用的生图模型）。缺前置会导致相关用例无法执行——这本身也常是一条校验用例。

---

## 二、定位策略（无源码改动）

生产组件中真实存在的 `data-testid` 很少，绝大多数 `*-dialog` / `*-panel` 等 testid 只出现在 `__tests__` mock 中、**运行时不存在**。因此定位**优先级**为：

1. **可见文案**（zh-CN i18n）：如按钮「保存」「检索」「发送」，Tab 名等。文案以各功能域 `reference.md` 文案表为准。
2. **role / aria**：`role="menu"` / `role="menuitem"`、`aria-label="更多"`、对话框 `role="dialog"`、`role="combobox"` / `role="option"` 等。
3. **生产 data-testid**：各功能域的真实 testid 清单见该域 `reference.md`（只列运行时真实存在的）。
4. **结构化兜底**：占位符（输入框 placeholder）等。

> Radix 组件（Select / Dropdown）的选项渲染到 **portal**，`snapshot` 未必抓得到——可先 `click` combobox，再在 `[role=option]` 里按文案定位；或用 `agent-browser eval` 直接点。
> `window.api` / `window.electron` 是 contextBridge **深度冻结**对象，**无法 stub** 任何方法；需要「原生选择器返回值」的场景（如文件夹选择）只能改用对应 `window.api.*` 直接驱动后端。
> 切换语言会改变文案。**测试统一在简体中文（zh-CN）界面下进行**。

---

## 三、用例记录约定

- 可执行用例固化在各功能域 `e2e.yaml`：每条 case 标 `status: validated`（已实测跑通）/ `draft`（按代码事实写、待实测核对），含精确步骤、定位线索、断言。复跑只认 `validated`。
- prose 版用例（`test-plan.md`）每条标注：`用例编号` / `目标` / `前置条件` / `步骤` / `预期结果` / `参考`（代码位置、接口、文案）。
- 执行时建议在各功能域目录追加 `runs/<日期>.md` 记录实际结果与截图，**不要改动计划文件的预期**（预期变化应另行评审）。
- 断言除了看 UI，还可在渲染进程 console 直接核对数据（`window.api.*`），或 tail 主进程日志（`/tmp/cherry-v2-e2e/debug.log`）佐证后端调用（如 `DataApi:*` 请求、provider/model id）。

---

## 四、实测启动配方（已验证 2026-06-09）

固定用于本测试项目的启动方式：

```bash
pnpm install                       # ⚠️ 拉新提交后必跑：API 网关 v2 引入了 @elysia/* 依赖，不装会构建失败
lsof -ti :9222 | xargs kill 2>/dev/null; lsof -ti :5173 | xargs kill 2>/dev/null
MAIN_VITE_USER_DATA_DEV_SUFFIX=KnowledgeV2FullTest nohup pnpm debug > /tmp/cherry-v2-e2e/debug.log 2>&1 &
# 等 CDP 端口（首次构建 ~30-60s）
for i in $(seq 1 60); do lsof -i :9222 | grep -q LISTEN && break; sleep 2; done
```

- **数据目录**：`~/Library/Application Support/CherryStudioKnowledgeV2FullTest`（基名 `CherryStudio` + 后缀 `KnowledgeV2FullTest`），全新隔离，与正式版 / 其它 dev profile 互不影响。全新数据**未弹 V2 迁移向导**，直接进主界面。
- **窗口隔离**：起来后把窗口移到 aerospace workspace 6，避免干扰当前工作区（务必先用 app-pid 比对监听 9222 的进程，确认是本 dev 实例而非正式版，再移动）：
  ```bash
  WID=$(aerospace list-windows --all --format '%{window-id} | %{app-pid} | %{app-name}' | awk -F' \\| ' '$3=="Electron"{print $1; exit}')
  aerospace move-node-to-workspace --window-id "$WID" 6
  ```
- **agent-browser 驱动**：
  ```bash
  agent-browser connect 9222
  agent-browser tab                 # t1 = .../windows/main/index.html 为主窗口
  agent-browser snapshot -i         # 取交互元素 ref
  agent-browser click <ref>
  agent-browser fill <ref> <值>
  agent-browser screenshot /tmp/cherry-v2-e2e/<name>.png
  agent-browser eval "<js>"         # 可直接调 window.api.* 做断言/清理
  ```
- 截图统一存 `/tmp/cherry-v2-e2e/`。

---

## 五、快速开始

1. 配好被测功能域所需模型（见各域 `reference.md` 前置）。
2. `MAIN_VITE_USER_DATA_DEV_SUFFIX=KnowledgeV2FullTest pnpm debug` 启动隔离实例。
3. `agent-browser connect 9222`，打开主窗口（t1）。
4. 进入目标功能域（侧边栏 / 应用列表入口）。
5. 按该域 `e2e.yaml`（复跑）或 `test-plan.md`（完整）逐条执行。
