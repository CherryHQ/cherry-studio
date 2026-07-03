# RFC: 多 Profile 基础架构

- 状态：草案
- 日期：2026-06-26
- 机制定义见 [design.md](./design.md)。

## 1. 摘要

在 v2 引入 **profile**：同一 App 实例内可并存多个完全隔离的本地 profile，每个 profile 是一套独立的本地数据（会话、助手、知识库、文件、设置），同一时刻激活一个，可在运行时切换、无需重启 App。核心机制是把"当前 profile"建模成一次**激活**——持有 profile 资源的服务在 `onProfileActivate` 绑定、`onProfileDeactivate` 释放；开机是第一次激活，切换是 deactivate 旧的、activate 新的。本 RFC 只覆盖数据 / 运行时层的地基；账号、同步等上层能力不在范围内。

## 2. 动机

用户需要在同一 App 内维护多套互不可见的本地环境：工作与个人分开、为试验保留干净环境、共享机器上的组织性区隔（非安全边界，见 §4 威胁模型）、为不同场景各存一套配置（不同 Provider / 助手 / 知识库）。

现状无法做到这一点而不重启：v2 在预启动阶段把数据根（SQLite 库、`Data/` 目录）一次性确定并冻结路径表。`app.setPath('userData')` 仅在 `app.ready()` 前有效（Chromium 存储位置在 ready 时定型），加上 v2 路径表预启动冻结，"换一套数据"等价于换数据根，目前只能通过重启进程实现。

目标是让当前激活的 profile 在运行时可切换、无需重启。心智模型是账号 / 工作区切换（如飞书 / Telegram 切换账号、Slack 切 workspace）：同一时刻聚焦一个，切换时整个 App 重新对准被激活的 profile。

「无需重启」源自体验判断：切换应当被感知为「切换」，而非应用死亡后重来。这一判断有产品面的支撑：主流应用的账号 / 工作区 / 租户切换普遍就地完成（Discord 切账号整端 reload、Teams 切租户 reload、VS Code 切 profile 窗口 reload；飞书 / Telegram / Slack / Notion 会话常驻）；进程重启对用户是可见的「应用死亡」（托盘消失、窗口布局重置、全局快捷键与划词助手中断）；且随账号绑定 / 同步的演进方向（§8），切换趋于常规操作。它同时以技术可行为前提：若平台使干净的热切换不可实现，体验偏好不构成强行实现的理由——可行性论证见 §6 与 design.md §9。

## 3. 指南级说明

一个 **profile** 是一套隔离的本地数据，对应磁盘上一个独立目录与一个独立 SQLite 库。任意时刻有且仅有一个激活 profile；切换 profile 即让整个 App 重新对准另一个 profile。

### 对功能开发者透明

profile 只存在于基础设施层。功能开发者无需感知它，沿用既有数据访问方式即可拿到当前激活 profile 的数据：

- 渲染层：`useQuery('/topics')`、`usePreference('ui.theme_mode')` —— 返回当前 profile 的数据；
- 主进程服务层：经 `application.get('DbService')` 访问库 —— 落在当前 profile 的库；
- 路径：`application.getPath('feature.files.data')` —— 解析到当前 profile 的目录。

业务代码不传 profileId、不写 `where profile_id = …`。只有少数服务需要感知切换——持有 per-profile 句柄 / 缓存 / 在途工作的服务（名单见 design.md §10）；纯读库、不缓存、不持句柄的业务服务透明——DB 一换，它们下次调用自动落到新库。

### 什么随 profile，什么全局共享

- 随 profile：业务数据（DataApi 表）、用户设置（`preference` 表）、`Data/` 下的文件 / 笔记 / 知识库、Claude Code 会话与外部服务凭据、webview 登录态（小程序 / OAuth 弹窗，分区按 profile 命名）。判据按**内容**：装 per-profile 用户内容的归 profile，其余归 app；内容优先于历史落点（如 AI trace、Copilot token、MCP OAuth 虽历史落在共享目录，内容为 per-profile，随 profile 隔离）。
- 全局共享（不随切换）：BootConfig、`~/.cherrystudio/` 下的工具 / 模型安装、主进程可丢失状态（窗口几何等）。

### 切换

`ProfileService.switchProfile(id)` 是切换入口。切换在提交点生效，全程无 App 重启；主窗口会 `reload` 一次（约几百毫秒）。

## 4. 决策

机制展开见 design.md 对应章节。

- **隔离粒度：库级。** 每 profile 独立 SQLite 文件 + 独立 `Data/` 目录，完全物理隔离；不用行级判别列，不用 ATTACH 多库（理由见 §6）。
- **激活模型：独立 `ProfileActivatable` 契约。** 与功能启停轴 `Activatable` 正交；开机 = 第一次激活，切换与开机走同一路径（含恢复 / arming 的统一编排）。job handler 保持 profile-agnostic（注册一次、dispatch 时现取数据）。
- **路径：`userData` 恒定，profile 是其下的应用层子目录。** 路径 key 穷尽分为 app 级 / profile 级两桶，无第三桶；分类由代码 + 测试锁定，非文档名单。未选定 profile 时对 profile 级键报错，不做兜底。
- **注册表：`~/.cherrystudio/profiles.json`，预启动可读。** `id` 为不可变的 8 位 base62 nanoid（无前缀）；默认 profile 用保留 id `default`。
- **既有用户迁移：默认 profile 显式映射 legacy 根，零迁移、不搬文件。**
- **Chromium 网页存储：源头隔离，切换不清除。** webview 分区按 profile 命名（`persist:webview-<id>`，默认 profile 沿用 legacy 名，零迁移），OAuth 弹窗开窗时取当前 profile 分区；app 窗口的 default session 不搬迁，其唯一许可用途（renderer persist cache）按 key 命名空间隔离。切走再切回，各 profile 的登录态与 UI 状态原样恢复。机制见 design.md §9。
- **切换语义：** 磁盘激活指针只在提交点更新，故永远指向"最后稳定 profile"；提交前失败回滚到原 profile，回滚失败升级为 `app.relaunch()` 直入目标 profile（先 flush 与 shutdown）——进程重启是本设计的可靠性下限，热路径是其上的优化；提交后失败不回滚。切换期间对 profile 级访问返回明确的"切换中"错误，而非半初始化状态。renderer 以"关闭非主窗口 + 主窗口 reload"重置（主窗口不销毁）。
- **威胁模型：命名空间级隔离，非安全边界。** 同一 OS 账户下无认证、无静态加密；日志等 app 级落盘可能携带跨 profile 内容。需要安全边界的用户应使用 OS 多账户；profile 锁 / 加密为非目标。
- **并发模型：单实例、单激活。** 单实例锁按 `userData` 划界，全部 profile 共享一个进程——由此免费获得每 profile 单写者不变量（同一 profile 不可能双开写库），同时排除了"多窗口多 profile 并发"（Chrome 模式）；改变该取舍须先改锁粒度。
- **可观察性契约：** 必须存在持久的当前 profile 标识（窗口标题 / 托盘 / 侧栏之一），由上层 UI 实现——用户在错误 profile 中输入敏感内容是数据风险，不是纯 UX 问题。本 RFC 声明契约，不定 UI 形态。

## 5. 取舍

- 每个 `ProfileActivatable` 服务都要正确实现绑定 / 释放——漏一项就句柄泄漏或串旧 profile。这是本设计最大的持续成本；结构性缓解见 design.md §14。
- job handler 的 profile-agnostic 是编码约束、非机制强制。
- 切换有一段 UI 阻塞窗口（deactivate/activate + 主窗口 reload）。
- 每 profile 一个库成倍增加磁盘占用，各 profile 各自 migrate + seed。

## 6. 理由与替代方案

### 隔离粒度：行级 / schema 级 / 库级

多租户隔离三档，本设计选**库级**。**行级判别**（每表加 profileId 列）是服务端 RLS 的本地对应，但 SQLite 无原生行级安全，只能应用层每查询过滤、漏一处即泄漏，且破坏开发者透明。**Schema 级**（SQLite 下 = `ATTACH` 多库）破坏透明、Drizzle 不原生支持、对"同时只一个"无实质优势。**库级**给完全物理隔离 + 透明访问，任意时刻只开一个库。

### 激活模型 vs stop/start 子树

用 `application.stop/start` 重启 profile 子树被否决的决定性理由有二：a) `_doStop` 会拆除 `onInit` 注册的全部 IPC handler，与"切换期间 IPC 保持注册"的目标直接冲突；b) 跨相位依赖对 stop 级联不可见（`@DependsOn` 仅限同相位），`stop(DbService)` 不会级联到它事实上的 WhenReady 依赖者。（`onInit`/`onReady` 本身在 `application.start()` 时会重跑，只有 `onAllReady` 是每进程一次——重跑与否不是关键论据。）激活契约可反复触发、被 await、释放对称，开机 = 第一次激活（与切换同路径），且只有需要感知 profile 的服务实现它。

### 其它替代

- 每 profile 重绑 Electron `userData`：`setPath` 只能预启动一次，切换必重启，否决。
- 渲染层精确缓存失效而非整窗 reload：缓存层分散、易漏易竞态，作为后续优化。
- 整进程 `relaunch`：能一次性消除全部切换复杂度，但违背"不重启"目标——作为**主路径**否决；它保留为切换失败的兜底终态（§4 切换语义），即本设计的可靠性下限。

### 不做的影响

当前"单一固定数据根"的假设会随 v2 持续固化——越多服务运行时访问库、越多路径焊进冻结注册表。趁 v2 收口期引入接缝成本最低。

## 7. 先例

运行时在隔离的账号 / 工作区间切换是成熟模式，实现形态分两种：**会话常驻**（飞书 / Telegram / Slack / Notion——全部账号同时保活，切换即换焦点）与**就地重载**（Discord 切账号整端 reload、Teams 切租户 reload、VS Code 切 profile 窗口 reload——进程存活、渲染层重建）。本设计取后者，单激活实现更简单。机制层面，Chrome 的 profile 系统即"单进程内运行时装卸完整数据上下文"的规模化先例：标准多 profile 流程（头像切换器，非 `--user-data-dir` 并行实例）将全部 profile 宿主于同一 browser 进程，按 profile 建/销服务（`ProfileKeyedServiceFactory`），本设计的单激活是其并发形态的严格简化。概念沿用 Firefox **profile**、Obsidian **vault**；与 Chrome 的并发多窗口不同，本设计严格同一时刻一个。命名采用 `profile`（`workspace` / `vault` 槽位已被占用）。

## 8. 非目标与未来可能

**非目标**：

- 安全边界（认证、静态加密、profile 锁）——见 §4 威胁模型。
- profile 复制 / 导出与跨 profile 实体迁移（如把 topic 从个人移到工作）。库级隔离下复制可退化为关库后的文件级拷贝，天然可行，但凭据是否随拷、id 是否重生成需先定义。
- 多窗口多 profile 并发（Chrome 模式）——见 §4 并发模型。
- app 窗口 default session 的**物理**隔离——其内容限于可丢缓存（renderer persist cache），按 key 命名空间隔离即可；物理同库残留属 §4 威胁模型。

**未来可能**：

- profile 可作为"账号 / 身份绑定""跨设备同步"的绑定基底；作为独立上层叠加，不在本 RFC。
- DataApi 的统一接缝使 profile 数据源未来可在本地与远程之间选择；本 RFC 仅做本地。
