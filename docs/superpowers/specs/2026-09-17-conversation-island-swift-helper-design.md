# macOS 灵动岛 Swift Helper 设计

日期：2026-09-17
状态：书面规格已确认，等待实现

## 目标

将 macOS 灵动岛的呈现层从独立 Electron `BrowserWindow` 直接替换为按需启动的 Swift 原生 helper，同时保留现有活动选择、排序、过期、导航和用户偏好语义。

这里的“Swift 原生”指 helper 直接调用 macOS AppKit 和 SwiftUI 创建 `NSPanel` 并渲染界面，不再为灵动岛启动 Chromium renderer。Swift 不只用于 iPhone；它也是 Apple 平台上开发 macOS 应用和系统 UI 的主要语言。

成功标准：

- 灵动岛不再创建额外的 Chromium renderer。
- 内置刘海屏与外接屏的视觉、悬停、多任务列表、点击导航和退出动画与现有功能等价。
- 第一个活动出现时才启动 helper；最后一个活动消失后隐藏面板，隐藏满 30 秒后退出 helper。
- helper 活跃但处于安静紧凑态时，测试机上的物理内存目标低于 20 MiB；无活动 30 秒后进程不存在。
- macOS arm64 和 x64 的开发与打包产物都能启动、通过签名校验，并且应用退出后没有孤儿 helper。

## 不在范围内

- 不改变活动的业务状态机、主活动选择、完成态保留时间或会话导航语义。
- 不新增用户设置，不迁移持久化数据，不修改 Preference、DataApi 或数据库 schema。
- 不解释或执行 `ui.custom_css`；原生面板只同步明暗模式、主色和用户字体。
- 不引入 XPC、Node native addon、Objective-C 桥接库或长期双实现。
- 不为 helper 失败保留 Electron `BrowserWindow` 回退。
- 不改变 Windows 或 Linux 行为；这些平台不构建也不启动 helper。

## 现状与依据

当前 `ConversationIslandService` 是生命周期服务，负责活动归并、主活动选择、元数据、展开状态、屏幕选择和导航目标；呈现层通过 WindowManager 打开一个透明、无边框、置顶的 singleton `BrowserWindow`。该窗口拥有独立 preload、React renderer、IpcApi 展开请求和一段通过 `osascript`/JXA 读取 AppKit 刘海几何的探测逻辑。

本机生产构建测量结果如下：

| 方案 | 物理内存 | RSS | 安静态 CPU |
| --- | ---: | ---: | ---: |
| 当前 Electron 灵动岛（320×38，真实页面） | 约 33 MiB | 约 124 MiB | 动画停止后接近 0 |
| 最小空 Electron `BrowserWindow` | 约 15 MiB | 约 82 MiB | 接近 0 |
| SwiftUI + `NSPanel` 原型 | 约 12 MiB | 约 42 MiB | 0 |

Electron 的共享进程和内存映射使 RSS 不能直接视为独占成本，因此验收以 `phys_footprint`、是否存在额外 renderer、空闲退出和 CPU/唤醒为主。当前 streaming 脉冲约为 0.456% CPU、63 次 idle wakeups/秒；完成态停止动画后约为 0.00017% CPU、0 次 idle wakeups/秒。

## 方案比较

### 方案 A：保留 `BrowserWindow`

改动最少，也天然复用 React、Tailwind 和自定义 CSS，但每次显示都需要 Chromium renderer，不能实现本次降低活跃内存和移除 Web 呈现层的目标。

### 方案 B：Electron 进程内 native addon

可在同一进程内调用 AppKit，但需要维护 Node/Electron ABI、N-API 与 Objective-C/Swift 桥接，原生崩溃还会直接带走主进程。它没有为一个小型浮层提供足够收益。

### 方案 C：独立 Swift helper（采用）

Electron 通过版本化 JSON Lines 控制一个无 Dock 图标的 Swift 子进程。该方案利用 AppKit/SwiftUI 的原生窗口能力，隔离原生崩溃，并允许 30 秒空闲退出。代价是增加一个小型跨进程协议和 macOS 构建产物；这些成本通过 feature-private host、严格协议和打包测试控制。

## 架构与所有权

```text
assistant / agent activity events
              │
              ▼
ConversationIslandService (Electron main)
  - 唯一业务状态所有者
  - activity reducer / primary selection
  - metadata / i18n / preferences
  - expanded state / target display
  - activityId -> navigation target
              │ versioned JSON Lines
              ▼
ConversationIslandNativeHost (feature-private child-process host)
  - spawn / ready handshake
  - latest-snapshot coalescing
  - idle timer / shutdown / crash circuit
              │ stdin/stdout
              ▼
Swift helper
  - AppKit NSPanel and display geometry
  - SwiftUI compact / detail / list rendering
  - hover timers and animation execution
```

`ConversationIslandService` 继续作为已注册的 `BaseService`，不新增应用级生命周期服务。`ConversationIslandNativeHost` 是该服务私有、单实例持有的多实例 helper class，不进入 `serviceRegistry.ts`，并随服务 stop/destroy 一起释放。这避免为了单个功能修改共享生命周期基础设施。

TypeScript 继续拥有所有业务真相。Swift 只保存渲染所需的最后一个已接受 revision 和短暂的指针/动画状态；它不选择主活动、不保存导航目标，也不写入持久化数据。

点击活动时，Swift 只回传 `activityId`。Electron 验证 revision 和活动仍然存在后，从当前活动表取出可信的 `ConversationNavigationTarget`，直接调用现有 `ConversationNavigationService.focusOrOpen(target, title)`。导航目标不会发送给 helper，也不会接受 helper 提供的路径或 URL。

## 进程生命周期

状态流固定如下：

```text
无进程
  └─ 第一个可呈现活动 ─▶ 启动中 ─ ready ─▶ 可见
                                           │
                       新快照/悬停/点击 ◀──┤
                                           │ 最后一个活动消失
                                           ▼
                                      退出动画 180 ms
                                           │ hidden
                                           ▼
                                         已隐藏
                                           │ 30 秒内无新活动
                                           ▼
                                          退出
```

- 功能开启但没有活动时不启动 helper。
- 启动期间只保留最新期望状态；收到 `ready` 后发送一次最新快照。
- `ready` 必须在 spawn 后 3 秒内到达，否则本次启动按崩溃处理。
- `dismiss` 到达后，helper 停止悬停计时，执行 180 ms 退出动画；启用“减少动态效果”时立即隐藏，然后发送对应 revision 的 `hidden`。
- Electron 只在收到当前 `dismiss` revision 的 `hidden` 后开始 30 秒空闲计时。期间出现新活动会取消计时并复用同一进程。
- 新 `present` 在退出动画完成前到达时，helper 取消退出并继续显示；旧 `hidden` 即使迟到也会因 revision 不匹配被忽略。
- 用户关闭功能时，helper 完成隐藏后立即退出，不保留 30 秒复用窗口。
- 应用关闭时先发送 `shutdown`；1 秒未退出则发送 `SIGTERM`，再过 1 秒仍未退出则发送 `SIGKILL`。
- helper 将 stdin EOF 视为父进程消失并立即退出，防止 Electron 异常结束后遗留孤儿进程。

## JSON Lines 协议

### 传输规则

- UTF-8，一条消息一个 JSON object，以 `\n` 结束。
- stdin 是 Electron → Swift 的唯一命令流；stdout 是 Swift → Electron 的唯一协议流。
- Swift 的诊断文本只写 stderr；Electron 按行转入 `loggerService` 的 `ConversationIsland:Native` context。
- 每行上限 1 MiB。超过上限、无效 UTF-8、无法解析的 JSON、未知版本或未知消息类型都会被丢弃并记录不含业务文本的结构化警告。
- 日志只记录消息类型、revision、进程状态和错误；不记录活动标题、身份名称或完整 payload。
- `version` 当前固定为 `1`。不兼容版本不会尝试猜测或降级。
- `revision` 是 Electron 产生的单调递增安全整数。Swift 忽略小于当前 revision 的状态消息；Swift 发出的交互必须回显其正在显示的 revision。

### Electron → Swift

`present` 发送完整快照，不发送增量：

```json
{
  "version": 1,
  "type": "present",
  "revision": 42,
  "payload": {
    "displayId": 1,
    "expanded": false,
    "reducedMotion": false,
    "theme": {
      "appearance": "dark",
      "primaryColor": "#00B96B",
      "fontFamily": ""
    },
    "primaryActivityId": "topic-id",
    "activityCountText": "2 个活动",
    "activities": [
      {
        "activityId": "topic-id",
        "identityAvatar": "🤖",
        "identityName": "Assistant",
        "state": "streaming",
        "statusText": "正在生成",
        "title": "性能分析"
      }
    ]
  }
}
```

活动 `state` 的闭集保持为 `pending`、`streaming`、`awaiting-confirmation`、`done`、`error`。`primaryActivityId` 必须存在于 `activities`；Swift 对不满足约束的快照整体拒绝，不渲染部分数据。

其他 Electron 消息：

- `dismiss { version, type, revision }`：结束当前可见状态。
- `shutdown { version, type }`：停止动画、关闭 panel 并退出进程。

### Swift → Electron

- `ready { version, type, pid }`：AppKit 初始化、panel host 和 stdin reader 均已就绪。
- `setExpanded { version, type, revision, expanded }`：500 ms 悬停或 250 ms 离开计时完成后的展开意图。
- `openActivity { version, type, revision, activityId }`：用户点击紧凑态或列表项。
- `hidden { version, type, revision }`：对应 `dismiss` 的退出动画和实际隐藏均已完成。

Electron 只接受等于当前 revision 的 `setExpanded` 和 `openActivity`。`openActivity.activityId` 还必须存在于当前活动表；无效消息只记录并丢弃，不执行导航。

### 启动与背压

- helper 未 ready 时，host 只保留最新 `present` 或 `dismiss`。
- child stdin 返回背压时，host 合并尚未写出的状态消息，只保留最大 revision 的最终状态；已经写入管道的消息不重排。
- `shutdown` 不参与合并，并会清除待发送的普通状态。
- line parser 必须正确处理半行、单个 chunk 中的多行和 EOF 前的不完整尾行。

## 崩溃与失败处理

- 活动可见或等待 ready 时发生异常退出，Electron 依次以 250 ms、1 秒、4 秒退避重新启动并重放最新完整快照。
- 60 秒滚动窗口内发生第 4 次异常退出时打开本次会话的熔断器：停止重启、写入集中日志，灵动岛暂不可用。
- 应用重启，或用户将 `feature.conversation_island.enabled` 关闭后重新开启，会重置熔断器。
- helper 已隐藏且没有待呈现活动时异常退出，不重启。
- helper 文件缺失、不可执行、架构不匹配、ready 超时或协议 stdout 损坏都按启动失败计入同一熔断策略。
- 不回退到旧 `BrowserWindow`。这样可确保发布产物只有一个行为路径，也能让打包错误在验证阶段暴露。

## 原生窗口与显示器几何

AppKit host 创建 `NSPanel`：

- `styleMask` 使用 `.borderless` 与 `.nonactivatingPanel`。
- panel 不成为 key/main window，不激活 Cherry Studio，但仍接受悬停和点击。
- `level` 与现有行为等价，使用 `.screenSaver`；`collectionBehavior` 包含 `.canJoinAllSpaces`、`.fullScreenAuxiliary` 和 `.stationary`。
- 背景透明、`isOpaque = false`、不在 Dock 或应用切换器中出现。

Electron 继续根据活动来源选择目标 `Display.id`。Swift 将该值与 `NSScreen.deviceDescription["NSScreenNumber"]` 对应；目标屏幕已移除时回退到主屏并在 stderr 记录一次警告。

Swift 直接读取 `NSScreen.safeAreaInsets`、`auxiliaryTopLeftArea` 和 `auxiliaryTopRightArea`：

- 存在位于屏幕顶部、宽度合理且居中的辅助区域间隙时，使用内置刘海布局。
- 否则使用屏幕顶部居中的胶囊布局，距顶部 8 pt。
- 现有紧凑尺寸、展开宽度、最大 4 行可见活动、单任务详情高度和多任务行高迁移为 Swift 中的集中常量，并由几何单元测试覆盖。
- Swift 监听屏幕参数变化，在显示器连接、断开或缩放变化时，用最后快照重新定位，不需要 JXA/`osascript`。

## UI 与交互等价

### 呈现状态

- 内置刘海屏紧凑态：左右信息区避开物理遮挡，显示状态、标题或活动数。
- 外接屏紧凑态：显示圆角胶囊、状态点、状态文本、标题或活动数。
- 展开且只有一个活动：显示身份头像、身份名称和一行活动详情。
- 展开且有多个活动：显示冻结顺序的活动列表、主活动标记和最多 4 行可见内容。

`ConversationIslandService` 继续使用现有 `expandedActivityState` 冻结展开期间的顺序并处理活动消失；Swift 只按完整快照渲染。

### 交互

- 指针持续进入 500 ms 后发送展开意图；离开 250 ms 后发送收起意图。
- 点击紧凑态打开主活动。点击展开列表项时 Swift 只发送一次 `openActivity`；Electron 在验证旧 revision 有效后，于同一处理内先将展开状态收起，再聚焦或打开对应会话，避免 `setExpanded` 产生新 revision 后误拒绝点击事件。
- 新鲜重新进入、退出前离开等边缘行为沿用现有状态机语义，避免收起动画期间立即重新展开。
- panel 不抢键盘焦点，不引入新的键盘操作或菜单。

### 主题、文本与动效

- `appearance` 来自 Electron `nativeTheme.shouldUseDarkColors` 的已解析 light/dark 结果。
- `primaryColor` 来自 `ui.theme_user.color_primary`；非法颜色回退为默认 `#00B96B`。
- `fontFamily` 来自 `ui.theme_user.font_family`；空值或系统不存在该字体时使用 macOS system font。
- 所有状态文本、身份回退名和活动计数均由 Electron 使用现有 i18n key 解析后发送，Swift 不内置可见业务文案。
- 不读取或解释 `ui.custom_css`，也不使用 code font preference。
- 只有 `pending` 和 `streaming` 状态点持续脉冲；其他状态静止。
- 遵循系统“减少动态效果”。该设置开启时，进入、展开、收起和退出都立即完成，但信息与交互不变。
- panel 隐藏后停止全部 SwiftUI animation、hover timer 和 display refresh 工作。

## 构建、路径与签名

Swift 源码位于 `packages/conversation-island-helper/`，使用 Swift Package Manager，无第三方依赖，`Package.swift` 明确声明 `.macOS(.v12)`。当前 Electron 41.8.0 bundle 的 `LSMinimumSystemVersion` 和 Mach-O `minos` 均为 12.0；`electron-builder.yml` 同时显式设置 `mac.minimumSystemVersion: "12.0"`，避免二者漂移。

统一构建脚本 `scripts/build-conversation-island-helper.js`：

- 非 macOS 直接成功退出且不产生文件。
- 开发模式构建当前 `process.arch`。
- `beforePack` 将 electron-builder 的目标 arch 映射为 `arm64` 或 `x64` 并调用同一脚本。
- 脚本执行 SwiftPM release build，检查 Mach-O 架构，将可执行文件复制到已被 `.gitignore` 覆盖的 `resources/binaries/darwin-<arch>/conversation-island-helper`，权限设为 `0755`。

开发环境从以下集中路径启动：

```text
application.getPath('app.root.resources.binaries')
  / darwin-<process.arch>
  / conversation-island-helper
```

打包时：

- 全局 `files` 过滤器排除 asar 内的 helper 副本。
- macOS `extraResources` 将当前 `${arch}` 的 helper 复制为 `Contents/Resources/conversation-island-helper`。
- 生产环境使用 `application.getPath('app.extra_resources', 'conversation-island-helper')`，不新增 path registry key，也不使用 `app.getPath()` 或手工拼装安装根目录。
- `mac.binaries` 包含 `Contents/Resources/conversation-island-helper`，使 electron-builder 使用与应用一致的 identity 和 inherited entitlements 签名该 Mach-O。
- `codesign --verify --deep --strict`、`codesign -dv` 和 `lipo -archs` 用于打包验收。

`pnpm dev` 在启动 Electron 前调用统一构建脚本。现有 macOS release 与 nightly job 在打包前运行 Swift XCTest；Linux/Windows CI 不要求 Swift 或 Xcode。

## 代码变更边界

### 保留并调整

- `ConversationIslandService`：保留生命周期、活动 reducer、展开状态、偏好监听和目标显示选择；将 WindowManager 调用替换为 feature-private host。
- `activityReducer.ts` 与 `expandedActivityState.ts`：继续作为 TypeScript 业务合同并保留现有单元测试。
- `ConversationNavigationService`：复用公开的 `focusOrOpen`，不扩展 IpcApi。
- `scripts/before-pack.js`、`electron-builder.yml`、开发脚本：加入目标架构构建和 macOS 资源签名。

### 新增

- `ConversationIslandNativeHost.ts`：子进程、握手、协议、背压、空闲退出与崩溃熔断。
- feature-private 协议 codec/types 与对应 Vitest。
- `packages/conversation-island-helper/`：AppKit window host、SwiftUI surface、协议模型、几何与 XCTest。
- `scripts/build-conversation-island-helper.js` 及脚本测试。

### 删除

- WindowManager 的 `WindowType.ConversationIsland` 注册及只服务于它的测试。
- `src/preload/conversationIsland.ts` 与 preload 测试。
- `src/renderer/windows/conversationIsland/` 的 React 页面、入口、motion/surface helper 与测试。
- `electron.vite.config.ts` 中专用 preload 和 renderer entry。
- `conversation_island.set_expanded` 的 IpcApi schema、handler、聚合导出与 handler 测试。
- 不再跨 renderer 使用后，将 `src/shared/types/conversationIsland.ts` 收回到 feature-private main 协议类型。
- `macScreenGeometry.ts`、JXA/`osascript` 探测和相应测试；几何合同迁移到 Swift XCTest。

旧实现只在新 helper 的单元、运行时和打包验收通过后删除，但最终提交不携带运行时开关或旧 UI 回退。

## 测试与验收

### TypeScript / Vitest

测试必须捕获这些合同回归：

- JSON Lines 半行、多行、超长行、无效 JSON 和未知版本不会污染后续合法消息。
- ready 前多次更新和 stdin 背压只发送最高 revision 的最终状态。
- `hidden` 只有匹配当前 dismiss revision 时才启动 30 秒空闲退出。
- 新活动取消退出动画/空闲计时并复用进程。
- 旧 revision、未知 activityId 和不存在的活动不能触发展开或导航。
- active crash 按 250 ms、1 秒、4 秒重启并重放；60 秒内第 4 次异常退出熔断。
- idle crash 不重启；service stop 与 stdin EOF 路径不留下子进程。
- service 仍保持当前 reducer、展开顺序、完成态过期和显示器选择语义。
- 构建脚本拒绝不匹配的 Mach-O 架构，并在非 macOS 安全 no-op。

### Swift XCTest

- Codable discriminated messages 与协议 fixtures 兼容。
- 非法 version、revision、颜色、缺失主活动和未知状态被拒绝或按规定回退。
- compact、single-detail、activity-list 的纯投影结果正确。
- 刘海检测、外接屏 fallback、多显示器坐标和最大 4 行尺寸正确。
- 500/250 ms hover 状态机、新鲜重新进入和 dismiss 取消路径正确。
- reduced motion 时没有延迟动画；隐藏后动画和 timer 均停止。

### 真实运行时

在项目已跟踪的 Electron 实例中分别触发 assistant 和 agent 活动，验证：

- 紧凑态、刘海/胶囊定位、500 ms 展开、250 ms 收起和多任务冻结顺序。
- 点击紧凑态及列表项只打开正确会话，panel 不抢焦点。
- streaming 脉冲、done/error 静止、180 ms 退出和减少动态效果。
- 显示器可用时覆盖主屏与外接屏；显示器拔出后回退主屏。
- 最后活动结束后 panel 隐藏，30 秒后 helper PID 不存在。
- 强制结束 helper 后能限速重启并重放；应用退出后没有孤儿 helper。

### 打包与性能

- 分别运行 arm64 与 x64 的 macOS unpacked build。
- 确认 `Contents/Resources/conversation-island-helper` 存在、可执行、架构匹配且签名与 app 有效。
- 启动 unpacked app 并完成一次呈现、点击导航、隐藏和空闲退出。
- 活跃安静紧凑态在同一测试机上采样 10 秒后的 `phys_footprint`，目标低于 20 MiB；确认不再出现灵动岛 Chromium renderer。
- 无动画安静态应接近 0% CPU；隐藏状态必须无 helper 进程，因此没有持续唤醒成本。

## 完成定义

满足以下全部条件才算完成：

1. macOS 灵动岛由 AppKit/SwiftUI helper 唯一呈现，旧 BrowserWindow 链路已删除。
2. 现有视觉状态、悬停节奏、多任务列表、导航、退出动画和 reduced-motion 行为通过真实运行时验收。
3. 第一个活动按需启动，最后活动隐藏后 30 秒退出，应用关闭无孤儿进程。
4. helper 不接收导航目标，不写持久化数据，所有反向动作通过 revision 和 activityId 验证。
5. arm64/x64 产物架构正确、可执行、签名有效，非 macOS 构建不受影响。
6. 目标 Vitest、Swift XCTest、文档检查、lint 和打包检查通过。
7. 性能测量确认没有额外 Chromium renderer，helper 安静紧凑态物理内存低于 20 MiB。
