# macOS 灵动岛 Swift Helper 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 用按需启动、隐藏 30 秒后退出的 AppKit/SwiftUI helper 完整替换 macOS 灵动岛的 Electron `BrowserWindow`，同时保留现有业务状态、视觉交互、导航与打包签名合同。

**架构：** `ConversationIslandService` 继续拥有活动、显示器、展开状态、文案和可信导航目标；feature-private `ConversationIslandNativeHost` 通过版本化 JSON Lines 驱动 Swift 子进程；Swift helper 只负责 `NSPanel` 几何、SwiftUI 渲染、悬停计时和动画。新链路通过后一次性删除旧 renderer、preload、IpcApi 与 WindowManager 注册，不保留双实现或回退开关。

**技术栈：** Electron 41、TypeScript、Vitest 3、Node `child_process`、Swift 6 / Swift Package Manager、AppKit、SwiftUI、electron-builder 26、GitHub Actions。

---

## 实施前合同

- 设计来源：[macOS 灵动岛 Swift Helper 设计](../specs/2026-09-17-conversation-island-swift-helper-design.md)。实现中发现合同冲突时先更新并重新确认设计，不在代码里静默改语义。
- 只支持 macOS 12 及以上；Windows/Linux 不构建、不打包、不启动 helper。
- 不修改 Preference、DataApi、数据库 schema、`serviceRegistry.ts` 的服务集合，也不新增路径注册项。
- `ConversationIslandService` 是唯一业务状态所有者；Swift 不接收 `ConversationNavigationTarget`，不写持久化数据。
- 每个任务都遵循测试先行：先写能捕获该任务回归的失败测试，确认失败原因正确，再写最少实现。
- 每个提交使用下方给定的 Conventional Commit，并执行 `git commit -S --signoff`；随后以 `git cat-file commit HEAD | rg '^gpgsig '` 和 `git log -1 --format='%B' | rg '^Signed-off-by:'` 验证签名与 DCO。
- 实现期间不要运行全仓测试作为日常反馈；使用任务内的目标测试。最终任务再运行 `pnpm lint`、目标 Vitest、Swift XCTest、文档与打包验收。

## 文件职责总览

### 新增：Electron 主进程

- `src/main/services/conversationIsland/conversationIslandProtocol.ts`：协议 v1 类型、编码、反向事件解码和 1 MiB JSONL 分帧。
- `src/main/services/conversationIsland/ConversationIslandNativeHost.ts`：spawn、ready、背压合并、隐藏空闲、优雅退出、重启退避和熔断。
- `src/main/services/conversationIsland/__tests__/conversationIslandProtocol.test.ts`：协议、半行、多行、坏行与恢复合同。
- `src/main/services/conversationIsland/__tests__/ConversationIslandNativeHost.test.ts`：进程与时序合同。

### 新增：Swift helper

- `packages/conversation-island-helper/Package.swift`：macOS 12、core library、helper executable、XCTest targets。
- `packages/conversation-island-helper/.gitignore`：忽略 SwiftPM 的 `.build/` 与 `.swiftpm/` 本地产物。
- `packages/conversation-island-helper/Sources/ConversationIslandCore/Protocol.swift`：Codable 命令/事件和语义验证。
- `packages/conversation-island-helper/Sources/ConversationIslandCore/JSONLineFramer.swift`：逐字节 JSONL 分帧及 1 MiB 限制。
- `packages/conversation-island-helper/Sources/ConversationIslandCore/SurfaceModel.swift`：compact / single-detail / activity-list 纯投影。
- `packages/conversation-island-helper/Sources/ConversationIslandCore/Geometry.swift`：刘海识别、面板尺寸与 AppKit 坐标定位。
- `packages/conversation-island-helper/Sources/ConversationIslandCore/HoverState.swift`：500/250 ms 与 fresh-reentry 状态机。
- `packages/conversation-island-helper/Sources/ConversationIslandCore/Motion.swift`：进入、退出、reduced-motion 动效计划。
- `packages/conversation-island-helper/Sources/ConversationIslandCore/Theme.swift`：颜色与字体回退的纯解析。
- `packages/conversation-island-helper/Sources/ConversationIslandHelper/main.swift`：accessory app 入口和 stdin EOF 退出。
- `packages/conversation-island-helper/Sources/ConversationIslandHelper/HelperController.swift`：协议循环、revision、屏幕变化与 panel 生命周期。
- `packages/conversation-island-helper/Sources/ConversationIslandHelper/IslandPanel.swift`：非激活 `NSPanel` 配置与定位。
- `packages/conversation-island-helper/Sources/ConversationIslandHelper/IslandView.swift`：三种 SwiftUI surface、点击、状态点和动画。
- `packages/conversation-island-helper/Tests/ConversationIslandCoreTests/*.swift`：协议、分帧、投影、几何、hover、motion、theme 合同。
- `packages/conversation-island-helper/Tests/ConversationIslandCoreTests/Fixtures/*.jsonl`：TypeScript/Swift 共用协议 fixtures。

### 新增：构建

- `scripts/build-conversation-island-helper.js`：平台/架构解析、SwiftPM release build、Mach-O 校验、复制和 chmod。
- `scripts/__tests__/build-conversation-island-helper.test.ts`：非 macOS no-op、命令参数、架构拒绝和输出权限。

### 修改

- `src/main/services/conversationIsland/ConversationIslandService.ts`：从 WindowManager 呈现切换为 native host，增加主题和可信反向动作处理。
- `src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts`：以 fake native host 验证业务到协议的映射及交互校验。
- `package.json`：helper build/test scripts，并把 helper build 接入 `dev`。
- `scripts/before-pack.js`、`scripts/__tests__/before-pack.test.ts`：macOS 目标架构构建。
- `electron-builder.yml`：最低系统版本、files 排除、extraResources 与 `mac.binaries` 签名。
- `.github/workflows/ci.yml`、`.github/workflows/release.yml`、`.github/workflows/nightly-build.yml`：macOS Swift XCTest gate。
- `electron.vite.config.ts`、`src/main/core/window/types.ts`、`src/main/core/window/windowRegistry.ts` 及相关测试：移除旧窗口入口。
- `src/shared/ipc/schemas/ipcSchemas.ts`、`src/main/ipc/handlers/ipcHandlers.ts`：移除旧展开 IpcApi 聚合。

### 删除

- `src/main/services/conversationIsland/macScreenGeometry.ts`
- `src/main/services/conversationIsland/__tests__/macScreenGeometry.test.ts`
- `src/shared/types/conversationIsland.ts`
- `src/shared/ipc/schemas/conversationIsland.ts`
- `src/main/ipc/handlers/conversationIsland.ts`
- `src/main/ipc/handlers/__tests__/conversationIsland.test.ts`
- `src/preload/conversationIsland.ts`
- `src/main/core/window/__tests__/conversationIslandPreload.test.ts`
- `src/renderer/windows/conversationIsland/` 整个目录

## 任务 1：锁定 Electron 侧协议 v1 与 JSONL 分帧

**文件：**

- 新增：`src/main/services/conversationIsland/conversationIslandProtocol.ts`
- 新增：`src/main/services/conversationIsland/__tests__/conversationIslandProtocol.test.ts`
- 新增：`packages/conversation-island-helper/Tests/ConversationIslandCoreTests/Fixtures/parent-commands.jsonl`
- 新增：`packages/conversation-island-helper/Tests/ConversationIslandCoreTests/Fixtures/helper-events.jsonl`

- [ ] **步骤 1：写协议 codec 的失败测试**

  覆盖以下真实合同，而不是只断言 mock 被调用：

  ```ts
  const decoder = new JsonLineDecoder()
  expect(decoder.push(Buffer.from('{"version":1,"type":"rea'))).toEqual([])
  expect(decoder.push(Buffer.from('dy","pid":42}\n{"version":1,"type":"hidden","revision":7}\n'))).toEqual([
    { kind: 'line', line: '{"version":1,"type":"ready","pid":42}' },
    { kind: 'line', line: '{"version":1,"type":"hidden","revision":7}' }
  ])

  expect(
    decodeConversationIslandHelperEvent(
      '{"version":1,"type":"openActivity","revision":7,"activityId":"topic-1"}'
    )
  ).toEqual({
    version: 1,
    type: 'openActivity',
    revision: 7,
    activityId: 'topic-1'
  })
  ```

  还要覆盖：无效 JSON、未知 `version`、未知 `type`、负数/非安全整数 revision、空 activityId、无效 UTF-8、超过 1 MiB 的行、EOF 残行，以及坏行后下一条合法消息仍可解析。

- [ ] **步骤 2：运行单测并确认因模块不存在而失败**

  ```bash
  pnpm exec vitest run --project main src/main/services/conversationIsland/__tests__/conversationIslandProtocol.test.ts
  ```

  预期：测试因 `conversationIslandProtocol` 尚不存在或导出缺失而失败；不能是测试环境启动错误。

- [ ] **步骤 3：实现 feature-private 协议类型**

  对外导出固定为以下窄表面，业务导航目标不得出现在任何 wire type 中：

  ```ts
  export const CONVERSATION_ISLAND_PROTOCOL_VERSION = 1 as const
  export const CONVERSATION_ISLAND_MAX_LINE_BYTES = 1024 * 1024

  export type ConversationIslandStateKind =
    | 'pending'
    | 'streaming'
    | 'awaiting-confirmation'
    | 'done'
    | 'error'

  export interface ConversationIslandActivityItem {
    activityId: string
    identityAvatar: string
    identityName: string
    state: ConversationIslandStateKind
    statusText: string
    title: string
  }

  export interface ConversationIslandPresentationPayload {
    displayId: number
    expanded: boolean
    reducedMotion: boolean
    theme: {
      appearance: 'light' | 'dark'
      primaryColor: string
      fontFamily: string
    }
    primaryActivityId: string
    activityCountText: string
    activities: ConversationIslandActivityItem[]
  }

  export type ConversationIslandCommand =
    | { version: 1; type: 'present'; revision: number; payload: ConversationIslandPresentationPayload }
    | { version: 1; type: 'dismiss'; revision: number }
    | { version: 1; type: 'shutdown' }

  export type ConversationIslandHelperEvent =
    | { version: 1; type: 'ready'; pid: number }
    | { version: 1; type: 'setExpanded'; revision: number; expanded: boolean }
    | { version: 1; type: 'openActivity'; revision: number; activityId: string }
    | { version: 1; type: 'hidden'; revision: number }

  export type JsonLineFrame =
    | { kind: 'line'; line: string }
    | { kind: 'error'; reason: 'invalid-utf8' | 'line-too-long' }

  export class JsonLineDecoder {
    push(chunk: Buffer): JsonLineFrame[]
    end(): { frames: JsonLineFrame[]; hadIncompleteLine: boolean }
  }

  export function encodeConversationIslandCommand(command: ConversationIslandCommand): Buffer
  export function decodeConversationIslandHelperEvent(line: string): ConversationIslandHelperEvent
  ```

  实现规则：按字节寻找 `0x0A` 后再以 fatal UTF-8 decoder 解码；超长行进入 discard-until-newline 状态；每次 parse 都手工校验对象形状、`version === 1`、安全整数和闭集字段；错误只带种类，不包含原始 line/payload。

- [ ] **步骤 4：写两端共用 fixtures 并让 TypeScript 测试消费**

  `parent-commands.jsonl` 顺序包含一条完整 `present`、一条 `dismiss`、一条 `shutdown`；`helper-events.jsonl` 包含 `ready`、`setExpanded`、`openActivity`、`hidden`。`present` fixture 必须包含五种 state 中至少 `streaming` 与 `awaiting-confirmation`，并保证 `primaryActivityId` 存在于 `activities`。

- [ ] **步骤 5：重跑目标测试**

  ```bash
  pnpm exec vitest run --project main src/main/services/conversationIsland/__tests__/conversationIslandProtocol.test.ts
  ```

  预期：全部通过。

- [ ] **步骤 6：提交协议合同**

  ```bash
  git add src/main/services/conversationIsland/conversationIslandProtocol.ts \
    src/main/services/conversationIsland/__tests__/conversationIslandProtocol.test.ts \
    packages/conversation-island-helper/Tests/ConversationIslandCoreTests/Fixtures
  git commit -S --signoff -m "feat(conversation-island): define native helper protocol"
  ```

## 任务 2：建立 Swift Package、协议解码与分帧

**文件：**

- 新增：`packages/conversation-island-helper/Package.swift`
- 新增：`packages/conversation-island-helper/.gitignore`
- 新增：`packages/conversation-island-helper/Sources/ConversationIslandCore/Protocol.swift`
- 新增：`packages/conversation-island-helper/Sources/ConversationIslandCore/JSONLineFramer.swift`
- 新增：`packages/conversation-island-helper/Tests/ConversationIslandCoreTests/ProtocolTests.swift`
- 新增：`packages/conversation-island-helper/Tests/ConversationIslandCoreTests/JSONLineFramerTests.swift`

- [ ] **步骤 1：创建最小 Swift package manifest**

  ```swift
  // swift-tools-version: 6.0
  import PackageDescription

  let package = Package(
      name: "ConversationIslandHelper",
      platforms: [.macOS(.v12)],
      targets: [
          .target(name: "ConversationIslandCore"),
          .testTarget(
              name: "ConversationIslandCoreTests",
              dependencies: ["ConversationIslandCore"],
              resources: [.copy("Fixtures")]
          )
      ]
  )
  ```

  同时写入 package-local `.gitignore`：

  ```gitignore
  .build/
  .swiftpm/
  ```

- [ ] **步骤 2：先写 Swift 协议与 framer 失败测试**

  测试直接从 `Bundle.module` 读取任务 1 的 fixtures，并断言：

  ```swift
  let command = try ParentCommand.decode(line: presentLine)
  guard case let .present(revision, payload) = command else {
      return XCTFail("expected present")
  }
  XCTAssertEqual(revision, 42)
  XCTAssertEqual(payload.primaryActivityId, "topic-id")
  XCTAssertEqual(payload.activities.map(\.state), [.streaming, .awaitingConfirmation])
  ```

  framer 测试按 UTF-8 字节切分 emoji，验证半个多字节字符不会被提前解码；再验证多行、坏 UTF-8、1 MiB 上限、discard 后恢复及 EOF 残行。

- [ ] **步骤 3：运行 Swift 测试并确认编译失败**

  ```bash
  swift test --package-path packages/conversation-island-helper
  ```

  预期：因 `ParentCommand`、`JSONLineFramer` 尚不存在而编译失败。

- [ ] **步骤 4：实现 Swift wire model 与语义验证**

  核心类型固定为：

  ```swift
  public enum ActivityState: String, Codable, Sendable {
      case pending, streaming, done, error
      case awaitingConfirmation = "awaiting-confirmation"
  }

  public enum ParentCommand: Equatable, Sendable {
      case present(revision: Int64, payload: PresentationPayload)
      case dismiss(revision: Int64)
      case shutdown
  }

  public enum HelperEvent: Equatable, Sendable {
      case ready(pid: Int32)
      case setExpanded(revision: Int64, expanded: Bool)
      case openActivity(revision: Int64, activityId: String)
      case hidden(revision: Int64)
  }
  ```

  `ParentCommand.decode(line:)` 使用 discriminator envelope 后再解对应 payload；拒绝非 v1、超出 JavaScript 安全整数范围的 revision、空活动列表、空 ID、重复 ID、主活动缺失。`HelperEvent.encodedLine()` 始终写单行 UTF-8 JSON 加换行。

- [ ] **步骤 5：实现 `JSONLineFramer`**

  `append(_ data: Data) -> [Result<Data, JSONLineFramingError>]` 只返回不含换行的完整 bytes；长度超过 1 MiB时返回一次 `.lineTooLong` 并丢弃到下一换行；`finish()` 报告 `.incompleteLine` 后清空。UTF-8 校验放在协议 decoder，确保 framing 与 parsing 错误可区分。

- [ ] **步骤 6：重跑 Swift 测试**

  ```bash
  swift test --package-path packages/conversation-island-helper
  ```

  预期：协议 fixtures 和 framing 测试全部通过。

- [ ] **步骤 7：提交 Swift 协议核心**

  ```bash
  git add packages/conversation-island-helper
  git commit -S --signoff -m "feat(conversation-island): add Swift helper protocol core"
  ```

## 任务 3：迁移 surface、几何、hover、motion 与 theme 纯逻辑

**文件：**

- 新增：`packages/conversation-island-helper/Sources/ConversationIslandCore/SurfaceModel.swift`
- 新增：`packages/conversation-island-helper/Sources/ConversationIslandCore/Geometry.swift`
- 新增：`packages/conversation-island-helper/Sources/ConversationIslandCore/HoverState.swift`
- 新增：`packages/conversation-island-helper/Sources/ConversationIslandCore/Motion.swift`
- 新增：`packages/conversation-island-helper/Sources/ConversationIslandCore/Theme.swift`
- 新增：相应 `Tests/ConversationIslandCoreTests/*Tests.swift`

- [ ] **步骤 1：先写 surface 与尺寸失败测试**

  断言 collapsed 永远投影为 `.compact`；expanded + 1 个活动为 `.singleDetail`；expanded + 多活动保持输入冻结顺序并标记 primary。尺寸合同逐项固定：

  | 活动数 | 尺寸 |
  | ---: | --- |
  | compact | 320×38 |
  | 1 | 420×82 |
  | 2 | 420×142 |
  | 3 | 420×194 |
  | ≥4 | 420×246 |

- [ ] **步骤 2：先写几何失败测试**

  使用纯值 `ScreenGeometry`，覆盖 120 pt 刘海间隙得到 compact 280×38、185 pt 间隙得到 345×38、展开宽 420、外接屏 top offset 8、多显示器负坐标、目标 display 缺失回退主屏、过宽或偏心间隙回退 capsule。

  AppKit 坐标结果必须使用：

  ```swift
  let x = screen.frame.midX - size.width / 2
  let y = screen.frame.maxY - topOffset - size.height
  ```

  刘海布局 `topOffset` 为 0，capsule 为 8；不要沿用 Electron 顶点坐标公式。

- [ ] **步骤 3：先写 hover 与 motion 失败测试**

  输入/效果模型固定为：

  ```swift
  public enum HoverInput: Equatable {
      case pointerEntered
      case pointerExited
      case snapshotChanged(expanded: Bool, dismissing: Bool)
      case expandDelayElapsed
      case collapseDelayElapsed
  }

  public enum HoverEffect: Equatable {
      case scheduleExpand(milliseconds: Int)
      case scheduleCollapse(milliseconds: Int)
      case cancelExpand
      case cancelCollapse
      case emitExpanded(Bool)
  }
  ```

  覆盖 500 ms 展开、250 ms 收起、dismiss 取消计时、展开点击后等待 compact 再 fresh-enter、离开再进入，以及 stale timer elapsed 不发事件。motion 断言进入 spring `224/25/1`、退出 `180 ms` 到 `opacity 0, scaleX 0.96, scaleY 0.82`，reduced motion 为立即完成。

- [ ] **步骤 4：先写 theme 失败测试**

  `#RGB` 与 `#RRGGBB` 转成 0 到 1 的 RGBA；非法、带 alpha、CSS 函数和空字符串回退 `#00B96B`。字体解析只返回去空格后的 family 名；实际字体不存在时的 system font 回退由任务 4 的 AppKit adapter 完成。

- [ ] **步骤 5：运行测试确认缺少实现**

  ```bash
  swift test --package-path packages/conversation-island-helper
  ```

  预期：新增类型未定义导致编译失败。

- [ ] **步骤 6：实现五个纯模块**

  几何常量完整迁移现有值：`fallbackTopOffset=8`、`minNotchWidth=40`、`maxNotchWidth=260`、`topEdgeTolerance=2`、`centerToleranceRatio=0.1`、`expandedWidth=420`、`minCompactNotchWidth=280`、`compactNotchSideWidth=80`、header 38、single 44、row 52、最多 4 行。所有类型为值类型并符合 `Equatable`，不在 core 中访问 `NSScreen`、timer 或 `NSColor`。

- [ ] **步骤 7：重跑 Swift 测试并提交**

  ```bash
  swift test --package-path packages/conversation-island-helper
  git add packages/conversation-island-helper
  git commit -S --signoff -m "feat(conversation-island): model native island behavior"
  ```

## 任务 4：实现 AppKit panel、SwiftUI surface 与 helper 运行循环

**文件：**

- 修改：`packages/conversation-island-helper/Package.swift`
- 新增：`packages/conversation-island-helper/Sources/ConversationIslandHelper/main.swift`
- 新增：`packages/conversation-island-helper/Sources/ConversationIslandHelper/HelperController.swift`
- 新增：`packages/conversation-island-helper/Sources/ConversationIslandHelper/IslandPanel.swift`
- 新增：`packages/conversation-island-helper/Sources/ConversationIslandHelper/IslandView.swift`
- 新增：`packages/conversation-island-helper/Tests/ConversationIslandCoreTests/SessionStateTests.swift`

- [ ] **步骤 1：为 revision、dismiss 和隐藏后的资源状态写失败测试**

  在 core 增加可测试 `SessionState`：低 revision `present/dismiss` 无效果；新 `present` 取消旧 dismiss；reduced motion dismiss 立即产生 `.hideAndAcknowledge(revision)`；普通 dismiss 产生 `.animateExit(revision, 180)`；hidden 后 `isAnimating=false` 且 hover timers 全取消。

- [ ] **步骤 2：运行 Swift 测试确认失败**

  ```bash
  swift test --package-path packages/conversation-island-helper
  ```

- [ ] **步骤 3：实现 accessory app 与协议 I/O**

  先在 `Package.swift` 增加 executable product 和依赖 core 的 `ConversationIslandHelper` executable target，然后一次性加入真实入口及其余 executable 源文件：

  ```swift
  products: [
      .executable(name: "conversation-island-helper", targets: ["ConversationIslandHelper"])
  ]
  // targets 数组中追加：
  .executableTarget(name: "ConversationIslandHelper", dependencies: ["ConversationIslandCore"])
  ```

  `main.swift` 设置 `NSApplication.shared.setActivationPolicy(.accessory)`、安装 delegate 并运行 event loop。`HelperController` 在串行 dispatch queue 用 `FileHandle.standardInput.readabilityHandler` 喂给 `JSONLineFramer`，所有 AppKit/SwiftUI 修改跳回 main actor；初始化完成后 stdout 仅写：

  ```swift
  try output.send(.ready(pid: getpid()))
  ```

  stdin EOF 必须在 main actor 关闭 panel 后调用 `NSApp.terminate(nil)`。协议错误只向 stderr 写 `kind`、`type`、`revision` 等元数据，不输出 line 或业务文本。

- [ ] **步骤 4：实现非激活 panel**

  `IslandPanel` 的最终配置必须同时满足：

  ```swift
  styleMask = [.borderless, .nonactivatingPanel]
  level = .screenSaver
  collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
  isOpaque = false
  backgroundColor = .clear
  hasShadow = false
  hidesOnDeactivate = false
  becomesKeyOnlyIfNeeded = true
  ```

  override `canBecomeKey`/`canBecomeMain` 为 `false`。panel 使用 `NSHostingView<IslandView>`，显示调用 `orderFrontRegardless()`，绝不调用 `activate`、`makeKey` 或改变当前 app focus。

- [ ] **步骤 5：实现 NSScreen adapter 与重定位**

  将 `NSScreen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]` 转成 Electron `displayId`；找不到时回退 `NSScreen.main ?? NSScreen.screens.first` 并只写一次 stderr warning。把 `safeAreaInsets`、两个 auxiliary top area 和 frame 转为任务 3 的纯 `ScreenGeometry`。监听 `NSApplication.didChangeScreenParametersNotification`，用最后 accepted snapshot 重算位置。

- [ ] **步骤 6：实现三种 SwiftUI surface**

  UI 数值必须与已批准设计一致：compact header 38、single detail body 44、list row 52、最多 4 行、notch 下圆角 12、capsule compact 圆角取高度一半、expanded capsule 圆角 12。状态色为 pending 中性、streaming info、awaiting-confirmation warning、done success、error destructive；只有 pending/streaming pulse。dark/light、primary color、字体都来自 payload；字体不存在时 `NSFont.systemFont`。

  点击 compact 发送 primary ID；点击 detail/list 只发送所点 activity ID。所有 outbound interaction 回显 view 当前 revision。hover reducer 的 timer 由 controller 持有，snapshot/dismiss/hidden 时按 effect 取消，避免 SwiftUI view 重建留下 timer。

- [ ] **步骤 7：实现动画与 hidden 回执**

  普通 dismiss 使用任务 3 的 180 ms 退出计划，动画完成后 `panel.orderOut(nil)` 再发送 `.hidden(revision:)`；reduced motion 立即 orderOut + hidden。新 `present` 到达时取消未完成 animator，应用新快照且不发送旧 hidden。

- [ ] **步骤 8：构建并做 stdin/stdout smoke test**

  ```bash
  swift test --package-path packages/conversation-island-helper
  swift build --package-path packages/conversation-island-helper -c release
  printf '%s\n' '{"version":1,"type":"shutdown"}' | \
    packages/conversation-island-helper/.build/release/conversation-island-helper
  ```

  预期：Swift tests 通过；helper stdout 先出现一条合法 `ready`，随后正常退出，没有额外诊断文本混入 stdout。

- [ ] **步骤 9：提交 native UI**

  ```bash
  git add packages/conversation-island-helper
  git commit -S --signoff -m "feat(conversation-island): render island with AppKit"
  ```

## 任务 5：实现 Electron host 的启动、合并、隐藏空闲与关闭

**文件：**

- 新增：`src/main/services/conversationIsland/ConversationIslandNativeHost.ts`
- 新增：`src/main/services/conversationIsland/__tests__/ConversationIslandNativeHost.test.ts`

- [ ] **步骤 1：建立可控 fake child 并写启动失败测试**

  测试通过构造参数注入 `spawnProcess`、`now` 与 timers；fake child 暴露 `stdin.write/end`、`stdout/stderr` EventEmitter、`kill`、`pid` 和 `exit`。先断言无 `present` 时不 spawn；首个 `present` 才 spawn；3 秒无 `ready` 触发一次启动失败处理。

- [ ] **步骤 2：写 ready 前合并与背压失败测试**

  连续给 revision 1、2、3，ready 后只写 revision 3。让第一次 `stdin.write` 返回 `false` 后再给 revision 4、5，`drain` 时只补写 revision 5；已被 `write(false)` 接受的完整 revision 3 不得重写或重排。

- [ ] **步骤 3：写 hidden/idle/复用失败测试**

  `dismiss({ version: 1, type: 'dismiss', revision: 8 }, true)` 后旧 `hidden(7)` 不启动 timer，`hidden(8)` 才启动 30 秒 timer；29.999 秒新 `present(9)` 取消 timer 且复用同一 PID；满 30 秒发送 `shutdown` 并退出。第二参数 `terminateAfterHidden=true` 时在匹配 hidden 后立即 shutdown。

- [ ] **步骤 4：写优雅关闭升级失败测试**

  `shutdown()` 清除 pending state，写 `shutdown` 并 end stdin；1 秒仍活着发送 `SIGTERM`，再 1 秒仍活着发送 `SIGKILL`。如果 child 提前退出，后续 signal timer 必须全部取消。

- [ ] **步骤 5：运行目标测试确认失败**

  ```bash
  pnpm exec vitest run --project main src/main/services/conversationIsland/__tests__/ConversationIslandNativeHost.test.ts
  ```

- [ ] **步骤 6：实现 host 窄 API**

  ```ts
  interface ConversationIslandNativeHostCallbacks {
    onReady?: (pid: number) => void
    onSetExpanded: (event: Extract<ConversationIslandHelperEvent, { type: 'setExpanded' }>) => void
    onOpenActivity: (event: Extract<ConversationIslandHelperEvent, { type: 'openActivity' }>) => void
  }

  export class ConversationIslandNativeHost {
    present(command: Extract<ConversationIslandCommand, { type: 'present' }>): void
    dismiss(command: Extract<ConversationIslandCommand, { type: 'dismiss' }>, terminateAfterHidden?: boolean): void
    resetCircuit(): void
    shutdown(): Promise<void>
  }
  ```

  常量固定为 ready 3,000 ms、idle 30,000 ms、TERM 1,000 ms、KILL 1,000 ms。host 自己验证 helper event revision 等于当前 desired revision 后才回调 service；service 在任务 7 再做业务级二次验证。

- [ ] **步骤 7：实现路径、日志和事件清理**

  以 `app.isPackaged` 选择路径：开发路径使用 `path.join(application.getPath('app.root.resources.binaries'), \`darwin-${process.arch}\`, 'conversation-island-helper')`；打包路径使用 `application.getPath('app.extra_resources', 'conversation-island-helper')`。spawn 选项固定 `{ stdio: ['pipe', 'pipe', 'pipe'] }`，不用 shell。stderr 每行以 `loggerService.withContext('ConversationIsland:Native')` 转入集中日志；Swift 端只允许输出 message type、revision、进程状态和错误种类，禁止业务文本，Electron 端限制单行长度且不读取 stdout payload 做日志。每次 child 结束必须移除 listener 与 timer。

- [ ] **步骤 8：重跑目标测试并提交**

  ```bash
  pnpm exec vitest run --project main src/main/services/conversationIsland/__tests__/ConversationIslandNativeHost.test.ts
  git add src/main/services/conversationIsland/ConversationIslandNativeHost.ts \
    src/main/services/conversationIsland/__tests__/ConversationIslandNativeHost.test.ts
  git commit -S --signoff -m "feat(conversation-island): manage native helper lifecycle"
  ```

## 任务 6：加入 active crash 退避与 60 秒熔断

**文件：**

- 修改：`src/main/services/conversationIsland/ConversationIslandNativeHost.ts`
- 修改：`src/main/services/conversationIsland/__tests__/ConversationIslandNativeHost.test.ts`

- [ ] **步骤 1：写 crash policy 失败测试**

  用 fake timers 验证 active/starting child 异常退出依次在 250、1,000、4,000 ms 后 spawn 并重放最新完整 `present`；60 秒滚动窗口内第 4 次打开 circuit，之后不再 spawn。hidden 且没有 desired present 时退出不重启。ready timeout、ENOENT、EACCES 和架构启动失败走同一记录入口，不重复计数 exit 事件。

- [ ] **步骤 2：写 reset 失败测试**

  `resetCircuit()` 清空 crash timestamps、取消 pending restart，并允许下一次 `present` 启动。正常应用 shutdown 不计 crash；helper 稳定超过 60 秒后旧 crash 自然滑出窗口。

- [ ] **步骤 3：运行目标测试确认合同未实现**

  ```bash
  pnpm exec vitest run --project main src/main/services/conversationIsland/__tests__/ConversationIslandNativeHost.test.ts
  ```

- [ ] **步骤 4：实现单一 `handleUnexpectedFailure` 路径**

  使用 `CRASH_WINDOW_MS=60_000`、`RESTART_DELAYS_MS=[250, 1_000, 4_000]`、`CIRCUIT_BREAKER_CRASH_COUNT=4`。先过滤窗口外 timestamps，再 push 当前时刻；数组长度达到 4 时打开 circuit，否则按本窗口的失败序号取延迟。每一代 child 带 generation token，ready timeout/`error`/`exit` 只有第一个能结算该代失败。

- [ ] **步骤 5：重跑测试并提交**

  ```bash
  pnpm exec vitest run --project main src/main/services/conversationIsland/__tests__/ConversationIslandNativeHost.test.ts
  git add src/main/services/conversationIsland/ConversationIslandNativeHost.ts \
    src/main/services/conversationIsland/__tests__/ConversationIslandNativeHost.test.ts
  git commit -S --signoff -m "feat(conversation-island): recover native helper crashes"
  ```

## 任务 7：将 `ConversationIslandService` 接到 native host

**文件：**

- 修改：`src/main/services/conversationIsland/ConversationIslandService.ts`
- 修改：`src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts`

- [ ] **步骤 1：把 service 测试的 WindowManager 呈现 mock 换成 fake host**

  `vi.mock('../ConversationIslandNativeHost')` 捕获 constructor callbacks 及 `present/dismiss/resetCircuit/shutdown`。保留现有 reducer、primary、metadata、display-origin、expiry、expanded-order 测试；删除只证明 `BrowserWindow.setBounds/showInactive/pushInitData` 的行为固定测试。

- [ ] **步骤 2：写 payload 与主题失败测试**

  assistant/agent 活动应产生完整 `present`：`displayId` 是现有来源屏、primary 在 activities 中、wire item 没有 `target`、状态/身份/标题仍为 Electron i18n 结果。偏好 `ui.theme_user.color_primary` 与 `font_family`、`nativeTheme.updated` 都刷新快照；非法主色发送默认 `#00B96B`；dark/light 取 `nativeTheme.shouldUseDarkColors`。

- [ ] **步骤 3：写反向交互安全失败测试**

  相同 revision 的 `setExpanded` 才修改展开态；旧 revision 无效果。`openActivity` 必须同时满足当前 revision 与当前 activities 中存在 activityId；有效点击在同一个 handler 先清空 expanded state、刷新 compact revision，再调用：

  ```ts
  void application.get('ConversationNavigationService').focusOrOpen(activity.target, metadata.title)
  ```

  不给 `requestingWindowId`，因为 helper 不是 WindowManager window。

- [ ] **步骤 4：写 enable/disable/stop 失败测试**

  功能开启且无活动不 spawn；关闭功能发送新 revision dismiss 且 `terminateAfterHidden=true`；重新开启调用 `resetCircuit`；正常最后活动过期发送 dismiss 但保留 30 秒复用；`onStop` await `host.shutdown()`。

- [ ] **步骤 5：运行 service 测试确认失败**

  ```bash
  pnpm exec vitest run --project main src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
  ```

- [ ] **步骤 6：替换 service 呈现路径**

  删除 windowId、positionedWindowId、geometries、exitTimer、lastSnapshot、probeController、screenCleanup、power subscription 与几何方法。保留 `screen` 只用于来源/目标 Display 选择，保留 WindowManager 只用于把聚焦 full-chrome window bounds 映射到 Display。

  装饰器调整为：

  ```ts
  @DependsOn(['WindowManager', 'ConversationNavigationService'])
  ```

  service 维护单调安全整数 `revision` 与 `currentPresentationRevision`；每次 `present`/`dismiss` 都递增。`buildPresentationPayload` 始终发送非空活动数组：collapsed 时只发送 primary（总数继续由 `activityCountText` 表示），expanded 时发送 `expandedActivityState` 冻结顺序的完整可见列表。

- [ ] **步骤 7：注册主题与偏好订阅**

  在 `onInit` 注册 `nativeTheme.on('updated', refresh)` 并由 `registerDisposable` 移除；订阅 `ui.theme_user.color_primary`、`ui.theme_user.font_family` 和现有 `app.language`。不要订阅或发送 `ui.custom_css`、code font。

- [ ] **步骤 8：重跑 service 与 reducer 目标测试**

  ```bash
  pnpm exec vitest run --project main \
    src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts \
    src/main/services/conversationIsland/__tests__/activityReducer.test.ts \
    src/main/services/conversationIsland/__tests__/expandedActivityState.test.ts
  ```

  预期：业务选择、过期、展开冻结和新 native payload 全部通过。

- [ ] **步骤 9：提交 service 集成**

  ```bash
  git add src/main/services/conversationIsland/ConversationIslandService.ts \
    src/main/services/conversationIsland/__tests__/ConversationIslandService.test.ts
  git commit -S --signoff -m "refactor(conversation-island): use native helper host"
  ```

## 任务 8：接入 Swift 构建、打包、签名与 CI

**文件：**

- 新增：`scripts/build-conversation-island-helper.js`
- 新增：`scripts/__tests__/build-conversation-island-helper.test.ts`
- 修改：`scripts/before-pack.js`
- 修改：`scripts/__tests__/before-pack.test.ts`
- 修改：`package.json`
- 修改：`electron-builder.yml`
- 修改：`.github/workflows/ci.yml`
- 修改：`.github/workflows/release.yml`
- 修改：`.github/workflows/nightly-build.yml`

- [ ] **步骤 1：写 build helper 失败测试**

  通过注入 `platform`、`arch`、`execFileSync` 和 fs adapter 测：非 darwin 不执行命令/不产文件；arm64 映射 `--arch arm64`，x64 映射 `--arch x86_64`；`lipo -archs` 不含目标架构时抛错；复制目标分别为 `resources/binaries/darwin-arm64/conversation-island-helper` 与 `resources/binaries/darwin-x64/conversation-island-helper`，且 chmod `0o755`。

- [ ] **步骤 2：运行 scripts 测试确认失败**

  ```bash
  pnpm exec vitest run --project scripts scripts/__tests__/build-conversation-island-helper.test.ts
  ```

- [ ] **步骤 3：实现统一构建脚本**

  导出并复用：

  ```js
  const buildConversationIslandHelper = ({ platform = process.platform, arch = process.arch } = {}) => {}
  module.exports = { buildConversationIslandHelper, resolveSwiftArchitecture }
  ```

  darwin 针对 arm64 执行 `swift build --package-path packages/conversation-island-helper -c release --arch arm64`，针对 x64 执行同一命令并使用 `--arch x86_64`；再以相同参数追加 `--show-bin-path` 获取准确输出目录。用 `lipo -archs` 校验后 `copyFileSync`、`chmodSync(0o755)`。CLI 接受 `--arch arm64|x64`；其他值明确失败。不要依赖 `.build/release` symlink。

- [ ] **步骤 4：接入 package scripts 与 beforePack**

  `package.json` 新增：

  ```json
  "build:conversation-island-helper": "node scripts/build-conversation-island-helper.js",
  "test:conversation-island-helper": "swift test --package-path packages/conversation-island-helper"
  ```

  `dev` 在 `dotenv electron-vite dev` 前调用 build script。`before-pack.js` 只在 `platform === 'darwin'` 时，以 electron-builder 的目标 arch 调用导出函数，发生失败直接终止打包。

- [ ] **步骤 5：写 beforePack 集成失败测试再实现**

  在 `before-pack.test.ts` mock builder，断言 darwin arm64/x64 各调用一次正确架构，win32/linux 不调用。运行：

  ```bash
  pnpm exec vitest run --project scripts \
    scripts/__tests__/build-conversation-island-helper.test.ts \
    scripts/__tests__/before-pack.test.ts
  ```

- [ ] **步骤 6：配置 electron-builder**

  全局 `files` 增加 `!resources/binaries/darwin-*/conversation-island-helper`，避免进入 asar。mac 配置精确加入：

  ```yaml
  mac:
    minimumSystemVersion: "12.0"
    binaries:
      - Contents/Resources/conversation-island-helper
    extraResources:
      - from: "resources/binaries/darwin-${arch}/conversation-island-helper"
        to: "conversation-island-helper"
  ```

  保留现有全局 migrations/provider-registry `extraResources` 和 mac 其他配置。

- [ ] **步骤 7：在 macOS workflows 加 XCTest gate**

  `ci.yml` 的 macOS platform-test job 在 install 后运行 `pnpm test:conversation-island-helper`；`release.yml` 和 `nightly-build.yml` 各自在 `Build Mac` 前新增同名 step，条件与 mac build 一致。Windows/Linux job 不安装或调用 Swift。

- [ ] **步骤 8：运行 scripts、Swift build 与当前架构校验**

  ```bash
  pnpm exec vitest run --project scripts \
    scripts/__tests__/build-conversation-island-helper.test.ts \
    scripts/__tests__/before-pack.test.ts
  pnpm test:conversation-island-helper
  pnpm build:conversation-island-helper
  test -x "resources/binaries/darwin-$(node -p 'process.arch')/conversation-island-helper"
  lipo -archs "resources/binaries/darwin-$(node -p 'process.arch')/conversation-island-helper"
  ```

  预期：测试通过；文件存在且可执行；`lipo` 输出当前 arch（Node `x64` 对应 Mach-O `x86_64`）。

- [ ] **步骤 9：提交构建链**

  ```bash
  git add scripts/build-conversation-island-helper.js \
    scripts/__tests__/build-conversation-island-helper.test.ts \
    scripts/before-pack.js scripts/__tests__/before-pack.test.ts \
    package.json electron-builder.yml .github/workflows
  git commit -S --signoff -m "build(conversation-island): package Swift helper"
  ```

## 任务 9：删除旧 Electron 灵动岛链路

**文件：** 见“删除”清单，并修改 WindowManager、Vite 与 IPC 聚合文件。

- [ ] **步骤 1：先加负向结构检查**

  更新现有 window registry 与 before-pack 测试，断言 registry 没有 ConversationIsland、Vite config 不再暴露 conversationIsland preload/renderer entry、非 mac package 也不需要旧输出过滤。用 `rg` 建立删除前失败基线：

  ```bash
  rg -n "WindowType\.ConversationIsland|conversation_island\.set_expanded|windows/conversationIsland|preload/conversationIsland|@shared/types/conversationIsland" \
    src electron.vite.config.ts scripts
  ```

  预期：删除前能找到旧链路引用。

- [ ] **步骤 2：删除 renderer、preload、IpcApi、旧 geometry 与 shared wire type**

  使用 `apply_patch` 删除文件。保留 `activityReducer.ts`、`expandedActivityState.ts` 及其测试；新的 wire types 只从 `conversationIslandProtocol.ts` 导入。

- [ ] **步骤 3：收紧聚合与构建配置**

  从 `electron.vite.config.ts` 移除专用 preload/input 和 renderer page；从 `WindowType` enum 与 `windowRegistry` 删除条目；删除 registry/preload 的专用测试区块；从 `ipcSchemas.ts`、`ipcHandlers.ts` 删除 import/spread。删除 `conversationIslandPackageFilters` 及其测试，因为不再有跨平台旧 renderer 产物。

- [ ] **步骤 4：运行引用扫描并确认旧链路归零**

  ```bash
  test -z "$(rg -l "WindowType\.ConversationIsland|conversation_island\.set_expanded|windows/conversationIsland|preload/conversationIsland|@shared/types/conversationIsland" src electron.vite.config.ts scripts || true)"
  ```

  预期：命令成功且无输出。`ConversationIslandService`、native host、Swift helper、偏好 key 与 i18n key 仍存在。

- [ ] **步骤 5：运行受影响测试与 node typecheck**

  ```bash
  pnpm exec vitest run --project main \
    src/main/services/conversationIsland/__tests__ \
    src/main/core/window/__tests__/windowRegistry.test.ts \
    src/main/core/window/__tests__/windowRegistry.invariants.test.ts
  pnpm exec vitest run --project scripts scripts/__tests__/before-pack.test.ts
  pnpm typecheck:node
  ```

  预期：全部通过，且 typecheck 不再解析旧 preload/shared type。

- [ ] **步骤 6：提交旧链路删除**

  ```bash
  git add -A src electron.vite.config.ts scripts/before-pack.js scripts/__tests__/before-pack.test.ts
  git commit -S --signoff -m "refactor(conversation-island): remove Electron window"
  ```

## 任务 10：完整验证、真实运行、打包签名与性能验收

**文件：**

- 可能修改：仅修复本计划引入的 lint/format/test 问题。
- 运行时证据：`.context/cherry-electron-dev/`（ignored，不提交）。

- [ ] **步骤 1：运行静态与单元 gate**

  ```bash
  pnpm lint
  pnpm exec vitest run --project main src/main/services/conversationIsland/__tests__
  pnpm exec vitest run --project scripts \
    scripts/__tests__/build-conversation-island-helper.test.ts \
    scripts/__tests__/before-pack.test.ts
  pnpm test:conversation-island-helper
  pnpm docs:check
  ```

  `pnpm lint` 会写格式；只保留本功能造成的变化。若 lint 改动代码，重跑对应目标测试并用 `chore(conversation-island): satisfy validation gates` 做签名提交。

- [ ] **步骤 2：按 `cherry-electron-dev` persistent 流程绑定实例**

  先读取并执行 `.agents/skills/cherry-electron-dev/references/electron-instance.md`：验证 `.context/cherry-electron-dev/instance.json` 中 PID、cwd、CDP listener 和 main target。因为主进程与原生二进制不可 HMR，若当前实例不是本 HEAD，记录身份后只按精确实例流程优雅替换；保留用户数据，最终留下健康实例运行。

- [ ] **步骤 3：做交互验收**

  在同一 tracked instance 中分别触发 assistant 与 agent 活动，记录 PID/CDP/target、窗口主题与显示器。逐项验证：compact；500 ms 展开；250 ms 收起；单任务详情；多任务冻结顺序与最多 4 行；点击 compact/list 打开正确会话且 panel 不抢焦点；streaming/pending pulse；done/error 静止；180 ms 退出；reduced motion；显示器拔出回退主屏。

- [ ] **步骤 4：做生命周期与故障验收**

  活动前确认无 helper PID；首活动出现 helper；最后活动结束时 panel 隐藏但 PID 保留；30 秒后 PID 消失。再次触发后强制结束“精确识别的 helper PID”一次，确认 250 ms 档重启并重放；退出/替换 Electron 时确认旧 helper 无孤儿进程。不要使用 broad `pkill`。

- [ ] **步骤 5：采集同场景性能证据**

  按 `.agents/skills/cherry-electron-dev/references/performance-debugging.md`，在 `.context/cherry-electron-dev/` 保存 quiet compact 10 秒采样。用 tracked PGID 区分 Electron main、renderer、Swift helper；把精确识别出的 helper PID 赋给 `ci_helper_pid`，记录 `ps` CPU/RSS，并用 `footprint "$ci_helper_pid"` 取 `phys_footprint`。验收：helper 安静 compact 物理内存 <20 MiB、无灵动岛 Chromium renderer、无动画态 CPU 接近 0、隐藏 30 秒后无 helper 因而无 wakeups。

- [ ] **步骤 6：分别构建并检查 arm64/x64 unpacked app**

  ```bash
  pnpm run build
  pnpm exec electron-builder --mac --dir --arm64 --config.directories.output=dist/conversation-island-arm64
  pnpm exec electron-builder --mac --dir --x64 --config.directories.output=dist/conversation-island-x64
  ```

  用以下脚本对两个输出中唯一的 app 和 helper 做检查：

  ```bash
  for ci_output_dir in dist/conversation-island-arm64 dist/conversation-island-x64; do
    ci_app_count=$(find "$ci_output_dir" -type d -name 'Cherry Studio.app' -prune | wc -l | tr -d ' ')
    test "$ci_app_count" -eq 1
    ci_app_path=$(find "$ci_output_dir" -type d -name 'Cherry Studio.app' -prune -print -quit)
    ci_helper_path="$ci_app_path/Contents/Resources/conversation-island-helper"
    test -x "$ci_helper_path"
    ci_archs=$(lipo -archs "$ci_helper_path")
    case "$ci_output_dir" in
      *arm64) test "$ci_archs" = "arm64" ;;
      *x64) test "$ci_archs" = "x86_64" ;;
    esac
    codesign -dv --verbose=4 "$ci_helper_path"
    codesign --verify --deep --strict "$ci_app_path"
  done
  ```

  若 app 数量不是 1，先只清理该任务自己的 `dist/conversation-island-arm64` 或 `dist/conversation-island-x64` 输出目录并重新构建，不猜路径。

- [ ] **步骤 7：启动两个 unpacked 产物做最小 smoke**

  各自完成一次 present、点击导航、dismiss 和 30 秒退出；在 Intel 二进制无法原生执行的 arm64 机器上使用系统 Rosetta（若已安装），没有 Rosetta 时记录 x64 为架构/签名静态通过并在 x64 CI runner 完成运行 smoke，不临时安装系统组件。

- [ ] **步骤 8：最终签名、状态与差异审计**

  ```bash
  git status --short
  git diff --check
  git log --format='%H %G? %s' 4a640e0e2f..HEAD
  for commit in $(git rev-list 4a640e0e2f..HEAD); do
    git cat-file commit "$commit" | rg -q '^gpgsig '
    git log -1 --format='%B' "$commit" | rg -q '^Signed-off-by:'
  done
  ```

  工作树只能剩 ignored runtime/build artifacts；所有本功能提交必须显示有效签名状态或至少含 `gpgsig`，并带 DCO signoff。最终报告精确列出测试、两个架构、codesign、helper PID 生命周期、物理内存、CPU、证据路径、tracked Electron PID/CDP/instance.json，以及仍运行的实例状态。

## 完成判定

- 旧 `BrowserWindow`、renderer、preload、IpcApi 和 JXA geometry 链路已完全删除。
- TypeScript 与 Swift 共用协议 fixtures；坏行、背压、revision、idle、shutdown、crash 和 circuit tests 通过。
- AppKit/SwiftUI 在真实 assistant/agent 场景中达到功能等价，不抢焦点。
- helper 按需启动、隐藏 30 秒退出；关闭功能与应用退出无孤儿进程。
- arm64/x64 helper 都被复制、chmod、签名且架构匹配；Windows/Linux 流程不要求 Swift。
- `pnpm lint`、目标 Vitest、Swift XCTest、`pnpm docs:check`、两个 unpacked package 与运行时/性能验收都有证据。
