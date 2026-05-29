# Cherry Studio UI Library Current Issues

> 更新日期：2026-04-16
> 范围：`packages/ui`
> 目的：记录 `@cherrystudio/ui` 当前已识别出的架构问题，作为后续 v2 UI 收口与拆分的依据。

## 背景

`packages/ui` 当前同时承担了多种职责：

1. React 组件库
2. 设计令牌与主题入口
3. 图标资源与图标代码生成产物
4. Storybook / design reference
5. 迁移过程中的旧栈兼容层

这让它在 monorepo 内部可以继续承担“迁移缓冲区”的角色，但也导致对外边界、发布契约和技术栈约束都不够稳定。

当前最核心的问题不是某一个组件实现有缺陷，而是 `@cherrystudio/ui` 还没有从“内部迁移目录”真正收敛为“边界稳定的 UI 库”。

## 核心问题

### 1. 发布契约与实际产物不一致

`packages/ui/package.json` 当前只发布：

1. `dist`
2. `README.md`

但 `exports` 仍然把样式子路径导向 `src/styles/*`：

1. `./styles`
2. `./styles/tokens.css`
3. `./styles/theme.css`
4. `./styles/index.css`

这意味着：

1. 在 workspace 内通过源码路径使用时看起来是可用的
2. 但一旦作为真正 npm 包消费，样式入口很可能不可用
3. UI 包现在依赖 monorepo 源码目录结构，而不是依赖稳定的发布接口

类似地，`./icons` export 指向 `dist/components/icons/index.*`，但当前构建产物并没有对应目录，说明 export 设计与构建配置之间也没有完全对齐。

结论：

`@cherrystudio/ui` 现在更像“源码别名入口”，而不是“可独立发布的包”。

### 2. 组件库边界仍然混入旧技术栈

虽然 v2 的方向是：

1. `@cherrystudio/ui`
2. Tailwind CSS
3. shadcn / Radix

但当前包里仍存在旧依赖残留：

1. `EditableNumber` 直接依赖 `antd`
2. `EditableNumber`、`Scrollbar`、`Sortable`、`HorizontalScrollContainer` 等仍在使用 `styled-components`
3. `tsdown.config.ts` 仍将 `styled-components` 作为 external 保留
4. `package.json` 的 devDependencies 中仍包含 `antd`、`styled-components`、`@types/styled-components`

这类残留的风险不是“包暂时还能跑”，而是：

1. 旧栈继续渗透到公共 API 层
2. renderer 在消费 UI 包时继续背负迁移债务
3. 后续要把 UI 库作为统一设计系统时，技术边界会持续被打破

如果一个公共 UI 包还默认允许旧技术栈存活，那么它就很难成为 v2 UI 重构的真正收口点。

### 3. 主题系统的所有权不清晰

当前主题系统分散在多个位置：

1. `packages/ui/src/styles/tokens.css`
2. `packages/ui/src/styles/theme.css`
3. `src/renderer/src/assets/styles/tailwind.css`
4. `src/renderer/src/hooks/useUserTheme.ts`

目前 renderer 直接导入：

1. `../../../../../packages/ui/src/styles/theme.css`
2. `../../../../../packages/ui/src/components/**/*.{js,ts,jsx,tsx}`

这说明应用层依赖的是 UI 包内部源码路径，而不是包导出的稳定入口。

同时，renderer 自己又在 `tailwind.css` 中补了一批 UI 包未收口的变量；`useUserTheme.ts` 也直接通过 DOM 写入：

1. `--color-primary`
2. `--primary`
3. `--color-primary-soft`
4. `--color-primary-mute`
5. 字体变量

结果是主题能力被拆散成 3 层：

1. token 层
2. theme 映射层
3. runtime 覆写层

但这三层目前没有明确的边界定义，导致以下问题：

1. 某个变量应该归 UI 包还是归应用层维护，责任不清晰
2. 新主题变量是否属于公开 contract，不明确
3. 后续做主题切换、用户自定义主题、组件样式统一时，定位成本会持续变高

### 4. 文档、目录说明与真实结构漂移

当前 `packages/ui/README.md` 与真实状态不一致，典型表现包括：

1. 仍然提到 `HeroUIProvider`
2. 示例与实际组件结构不一致
3. 目录说明仍是早期组件库结构
4. 对外文档没有准确反映当前发布方式、样式接入方式和限制

这种漂移会带来两个问题：

1. 团队成员难以判断哪些是现行方案，哪些只是迁移历史残留
2. UI 包的“设计目标”与“当前事实”长期不一致，导致重构决策缺少稳定依据

### 5. 单包职责过多

`packages/ui` 当前把以下内容放在同一个包里：

1. primitives / composites 组件
2. icons runtime catalog
3. icons source assets
4. icon generation scripts
5. design reference
6. Storybook
7. migration 文档

这会导致：

1. 包的定位不清晰
2. 评估变更影响范围时成本高
3. 构建、发布、文档、资源生成等 concerns 相互耦合
4. 很难判断哪些内容属于运行时依赖，哪些只是开发资产

体量大本身不是问题，职责不收口才是问题。

### 6. 内部实现路径被当成公共依赖使用

包内部大量通过 `@cherrystudio/ui/lib/utils` 引用 `cn` 等内部工具。

这类自引用在 monorepo 中短期可用，但会带来几个问题：

1. 内部模块边界被伪装成稳定包路径
2. 构建配置、路径映射和发布产物更难保持一致
3. 后续调整内部目录结构时，改动半径会被放大

更合理的方式应该是：

1. 包内部使用相对路径或明确的内部 alias
2. 对外只暴露真正承诺稳定的 public API

### 7. 测试覆盖与公开表面积不匹配

当前 `packages/ui` 的测试主要集中在：

1. 少量 primitives
2. CodeEditor 的工具函数
3. 图标脚本工具

但该包实际承载的公开能力远多于当前测试覆盖，包括：

1. 组件导出面
2. 样式入口
3. 图标 registry / fallback 逻辑
4. 旧组件兼容层
5. 主题入口与运行时约定

这会导致一个典型风险：

包的对外表面积已经很大，但“哪些行为是受保护 contract”仍然不清楚。

## 当前风险排序

### 高优先级

1. 发布入口与实际产物不一致
2. UI 包继续暴露 `antd` / `styled-components` 迁移债务
3. renderer 依赖 UI 包源码路径而不是稳定包接口

这些问题会直接阻碍 UI 包独立演进，也会影响后续 v2 收口。

### 中优先级

1. 主题变量 ownership 不清晰
2. 文档与现状漂移
3. 内部实现路径与公共 API 混用

这些问题不一定立刻导致功能故障，但会持续抬高维护成本。

### 低优先级

1. 包职责过多但尚未拆分
2. 测试覆盖不足但仍能支撑当前内部消费

这两项可以在完成边界收口后继续推进。

## 建议的收口方向

### 1. 先修“包是否真的可发布”

先统一发布契约：

1. `exports` 只能指向真实会发布的产物
2. 样式入口需要进入可发布目录，或明确声明该包仅供 workspace 内使用
3. `icons`、`styles` 等子路径 export 需要和构建产物一一对应

这一层不解决，后续所有“组件设计系统化”都仍然建立在不稳定基础上。

### 2. 把旧栈兼容层与正式 UI 层分离

需要明确哪些组件属于：

1. 正式 v2 UI 能力
2. 迁移期间兼容层

原则上：

1. 正式 UI 层不再继续引入 `antd`
2. 正式 UI 层不再继续引入 `styled-components`
3. 仍依赖旧栈的组件要么迁移，要么隔离到兼容目录，不应继续作为默认公共导出的一部分

### 3. 明确主题 contract

需要收敛主题系统的三层边界：

1. token 层负责什么
2. theme 映射层负责什么
3. runtime 用户主题覆写层负责什么

同时约定：

1. 哪些 CSS 变量是公开 contract
2. 哪些变量只能在 UI 包内部使用
3. renderer 应通过什么稳定入口接入主题

### 4. 把 `packages/ui` 的定位从“迁移缓冲区”改成“稳定边界”

长期看，`packages/ui` 应只保留与运行时 UI 强相关的内容：

1. 组件
2. 设计 token / theme contract
3. 图标 runtime 能力

而以下内容可以继续评估是否拆离：

1. 设计参考资料
2. 图标生成脚本
3. 迁移说明文档
4. 纯开发期辅助资源

## 优化方案

本方案不追求一次性“大拆大改”，而是按“先稳边界，再减耦合，最后做结构优化”的顺序推进。

这样做的原因很简单：

1. 当前 UI 库已经被 renderer 大量直接消费
2. 主题、样式、组件和图标已经形成事实耦合
3. 如果先做拆包或大范围目录调整，回归风险会高于收益

因此更合理的路径是先把 contract 固定下来，再逐步清理迁移债务。

### 方案目标

这轮优化的目标不是立刻把 `packages/ui` 变成一个完美的独立 design system，而是先完成以下四件事：

1. 让 UI 包具备稳定入口和明确边界
2. 停止旧技术栈继续向公共 UI 层渗透
3. 明确主题 contract 与运行时覆写边界
4. 为后续拆包、精简和独立发布创造条件

### 阶段划分

#### Phase 1: 边界收口

目标：

让 `@cherrystudio/ui` 先成为一个“入口稳定、对外契约清晰”的包。

主要工作：

1. 统一 `package.json` 中的 `exports`、`files` 和真实构建产物
2. 修正 `styles`、`icons` 等子路径 export 指向
3. 明确该包当前是“workspace-only”还是“可独立发布”
4. 停止 renderer 直接依赖 `packages/ui/src/*`
5. 建立最小 public API 清单

建议原则：

1. 对外只保留真正承诺稳定的入口
2. 包内部结构可以继续演进，但不应再被应用层直接依赖
3. 所有样式入口都必须经过稳定导出路径接入

阶段产出：

1. 一份更新后的 UI 包 public API 列表
2. 一组与构建产物一致的 package exports
3. renderer 对源码路径直连的替换清单

#### Phase 2: 旧栈隔离

目标：

把 `antd` / `styled-components` 从“正式 UI 层”中剥离出去。

主要工作：

1. 盘点所有仍依赖旧栈的组件
2. 将组件分为“正式能力 / 兼容层 / 待删除”三类
3. 优先迁移高频且低风险的旧组件
4. 在迁移完成后移除构建配置中的旧栈依赖保留

建议优先处理的组件：

1. `EditableNumber`
2. `Scrollbar`
3. `HorizontalScrollContainer`
4. `Sortable`

组件治理规则：

1. 正式导出的组件不得继续新增 `antd` 依赖
2. 正式导出的组件不得继续新增 `styled-components` 依赖
3. 尚未迁移完成的旧组件应显式标记为 compatibility，而不是混在默认公共能力里

阶段产出：

1. 旧栈组件清单与分类结果
2. compatibility 组件边界说明
3. 可移除的旧依赖列表

#### Phase 3: 主题系统收口

目标：

明确 token、theme、runtime override 三层职责。

建议分层：

1. `tokens`: 负责设计令牌
2. `theme`: 负责语义映射与 Tailwind 对接
3. `runtime override`: 负责用户主题与运行时覆写

主要工作：

1. 定义公开 CSS variable contract
2. 标记仅供内部使用的变量
3. 收敛 renderer 中补丁式变量定义
4. 约束 `useUserTheme` 只能覆写明确允许覆写的变量
5. 将应用层主题接入切换到稳定导出路径

建议规则：

1. token 负责“值”，不负责运行时行为
2. theme 负责“语义映射”，不负责用户配置读写
3. runtime override 只改 contract 明确开放的变量

CSS 变量分层约定：

1. `--cs-*` 是 design token namespace，来源于 `tokens/*`
2. `--color-*`、`--radius-*`、`--font-*` 是公开 theme contract，默认给组件和外部消费方使用
3. `--cs-theme-*` 是 runtime override input，只用于运行时覆写入口
4. `--primary` 这类变量属于 compatibility alias，只为兼容 shadcn / Tailwind 生态保留，不作为新代码首选

外部消费规则：

1. 普通业务包默认只依赖 `@cherrystudio/ui/styles/theme.css`
2. 普通业务包优先使用 `--color-*` 等公开 contract，不直接绑定 `--cs-brand-500` 这类 primitive token
3. 只有明确需要 token 层能力的设计系统配套包，才允许直接依赖 `@cherrystudio/ui/styles/tokens.css`
4. 运行时主题逻辑只允许写入 `--cs-theme-*` 这类受控入口变量，不直接写派生后的 `--color-*` 结果变量

阶段产出：

1. 一份主题 contract 文档
2. 一份运行时可覆写变量列表
3. renderer 侧主题接入方式收敛结果

#### Phase 4: 职责拆分与长期治理

目标：

在边界稳定后，再判断哪些内容应该继续留在 `packages/ui`，哪些应该拆出。

可评估拆离的内容：

1. 图标原始资产
2. 图标生成脚本
3. design reference
4. Storybook 专用资源
5. 迁移期说明文档

长期期望：

1. `packages/ui` 只保留运行时强相关内容
2. 开发辅助资源与构建素材不再和运行时包强绑定
3. UI 包的职责从“迁移缓冲区”收敛为“稳定基础设施”

阶段产出：

1. 包职责清单
2. 可拆离资源列表
3. 长期目录规划草案

## 执行顺序建议

推荐顺序如下：

1. 先修发布边界与稳定入口
2. 再切断 renderer 对 `src/*` 的直接依赖
3. 再迁移旧栈组件并清理 external 保留
4. 再收口主题 contract 与 runtime override
5. 最后再做职责拆分和目录优化

这样做的好处是：

1. 每一步都可以独立验证
2. 每一步都能降低未来改动成本
3. 不需要在一开始就承担拆包级风险

## 工作拆解建议

如果要真正落地，建议把这件事拆成 5 个 workstream 并行推进：

### Workstream A: 包边界与构建

负责：

1. `package.json`
2. `tsdown.config.ts`
3. 构建产物一致性
4. styles/icons export 收口

验收重点：

1. 所有 export 都能命中真实产物
2. 不再依赖源码目录结构对外工作

### Workstream B: 组件分级与兼容层治理

负责：

1. 组件分类
2. compatibility 策略
3. 旧栈组件迁移优先级

验收重点：

1. 团队能明确知道哪些组件是 v2 正式能力
2. 团队能明确知道哪些组件只是过渡层

### Workstream C: 主题与样式 contract

负责：

1. tokens/theme/runtime override 分层
2. CSS variable contract
3. renderer 接入收口

验收重点：

1. 应用层不再依赖 UI 包源码样式路径
2. 主题变量的归属清晰

### Workstream D: 图标与资源治理

负责：

1. runtime icon catalog
2. 图标源文件
3. 生成脚本
4. 是否需要拆离资源包

验收重点：

1. 运行时能力与生成流程边界清晰
2. 图标系统不会继续把 UI 包拖成“资产仓库”

### Workstream E: 文档与使用规范

负责：

1. README 修正
2. public API 文档
3. 迁移指引
4. 团队使用约束

验收重点：

1. 文档描述与真实结构一致
2. 新增组件和样式接入有统一约束

## 里程碑建议

### Milestone 1: 能稳定消费

达到以下条件即可视为第一阶段完成：

1. renderer 不再引用 `packages/ui/src/*`
2. styles 与 icons 入口可通过稳定 export 接入
3. README 至少不再误导使用方式

### Milestone 2: 停止继续欠债

达到以下条件即可视为第二阶段完成：

1. 正式 UI 层不再新增 `antd`
2. 正式 UI 层不再新增 `styled-components`
3. compatibility 范围被显式标注

### Milestone 3: 主题体系清晰

达到以下条件即可视为第三阶段完成：

1. token/theme/runtime override 边界明确
2. 用户主题只通过受控变量覆写
3. 应用侧不再补丁式兜底 UI 包变量

### Milestone 4: 包职责可持续

达到以下条件即可视为长期治理进入稳定期：

1. `packages/ui` 的运行时职责清晰
2. 非运行时资源有明确去向
3. UI 包可作为 v2 UI 基础设施持续演进

## 验收标准

优化完成后，至少应满足以下标准：

1. `@cherrystudio/ui` 的所有公开入口都具备稳定 contract
2. renderer 不再通过源码路径使用 UI 包
3. 正式导出组件不再依赖 `antd` / `styled-components`
4. 主题变量区分出 public contract 和 internal-only contract
5. 文档、构建、导出、消费方式保持一致

## 不建议的做法

在推进过程中，应避免以下方案：

1. 在 export 和源码路径并存的情况下长期维持“双轨接入”
2. 把所有旧组件都直接塞进正式导出中继续积债
3. 在主题边界未清楚前继续追加 renderer 兜底变量
4. 在发布边界未稳定前先做大规模拆包

这些做法看似能短期推进，实际会让 UI 包继续停留在“迁移缓冲区”状态。

## 一句话结论

`packages/ui` 当前最大的问题不是“还有一些旧代码”，而是它仍然同时扮演：

1. UI 库
2. 主题源码目录
3. 图标资产仓库
4. 迁移兼容层
5. 内部开发工作区

在 v2 继续推进之前，必须先把它收敛成一个边界稳定、发布契约明确、技术栈一致的 UI 包，否则它很难成为后续 UI 重构的基础设施。
