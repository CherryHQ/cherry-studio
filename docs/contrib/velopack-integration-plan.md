---
description: Velopack 三平台接入设计，覆盖更新策略、GitHub 发布、旧安装迁移、故障恢复和性能验收
sources:
  - src/main/services/AppUpdaterService.ts
  - src/main/main.ts
  - src/main/core/application/Application.ts
  - src/main/core/paths/pathRegistry.ts
  - src/main/ipc/handlers/app.ts
  - electron.vite.config.ts
  - electron-builder.yml
  - electron-builder.cn.config.cjs
  - build/nsis-installer.nsh
  - .github/workflows/release.yml
  - scripts/release/edition.js
  - scripts/release/release-artifacts.js
---

# Velopack 三平台接入方案

> 状态：客户端和双格式发布代码已接入，真实平台安装与性能验收待完成。更新日期：2026-10-10。当前实现范围以实施设计第 13 节为准。
> 本文规定目标架构和实施门槛，不表示 Velopack 已通过 Cherry Studio 的安装、迁移或性能验证。

实施契约见 [Velopack 实施设计](./velopack-implementation-design.md)：包含 ownership、生命周期依赖、函数与 IPC 设计、竞态协议、退出事务和可执行测试场景。

## 1. 目标与决策

接入 Velopack 管理 Windows 安装版、macOS 直接分发版和 Linux AppImage 的后续更新，继续使用 GitHub Releases 保存发布产物。保留现有更新 UI、版本选择策略、global/cn 隔离和发布审批流程。

本期仅改客户端与发布流水线，不修改 release 服务，不新增安装前在线授权。已有更新下载完成并通过本地校验后可以离线安装。

首要目标是缩短 Windows 用户点击安装后到新版可用的等待，特别是机械硬盘上的耗时。下载量、安装写入量和不可用时间分别测量，不以差分包体积代替安装性能。

实施采用“共同架构、分平台上线”：先完成三平台能力验证，再先向 Windows 测试渠道放量，macOS 和 AppImage 各自通过门槛后上线。Linux deb/rpm 仍由系统包管理器安装更新；Windows portable 暂时维持现有行为。

不在第一阶段自研补丁算法、硬链接复用、版本目录切换器或数据库自动降级。如果原生 Velopack 路径不能达到性能门槛，暂停替换，先提交上游能力改进评估，再决定是否另做独立更新器。

## 2. 当前系统与已确认事实

### 2.1 当前代码路径

| 环节 | 当前实现 | 接入影响 |
| --- | --- | --- |
| 更新协调 | `AppUpdaterService` 使用 electron-updater，负责渠道、定时检查、事件和安装 | 保留服务入口，内部按安装类型选择后端 |
| 更新策略 | 生产 feed 为 `https://releases.cherry-ai.com` | GitHub 是产物源，不应直接绕过托管服务的目标版本、镜像和升级网关策略 |
| 下载 | `disableDifferentialDownload = true` | 新后端需独立验证 delta 和全量回退 |
| 安装触发 | `quitAndInstall(true, true)`；普通退出不安装 | 保留用户明确点击安装的语义 |
| 关闭 | 窗口关闭后执行生命周期 shutdown，30 秒退出兜底 | 需要区分窗口关闭、进程退出和安装耗时 |
| Windows 包 | electron-builder 26.15.6，NSIS，`differentialPackage: false` | 过渡期并行输出旧包和 Velopack 包 |
| 首装扩展 | NSIS 包含架构、权限和 VC++ 运行库检查 | 在新安装流程实现等价能力，不能遗漏 |
| 发布 | 双 edition、多平台构建，汇总为 draft 后审批发布，另有镜像同步 | 新产物必须进入现有汇总、校验和审批步骤 |

当前 NSIS 模板的正常 7z 路径为：运行旧卸载器、逐文件移走旧文件、释放内嵌压缩包、解压到临时目录、复制到安装目录、再缓存整个安装 EXE。此结论来自本地锁定依赖的模板静态检查，尚无慢硬盘实测。

旧版移除运行的是旧安装中的卸载器；仅修改下一版安装包里的卸载逻辑，不能保证第一次迁移就消除旧路径开销。

现有系统详见 [App Update Architecture](./app-upgrade.md) 和 [Release Workflow Operations](./release-workflow.md)。托管服务自身实现不在本文审查范围，接入复用现有接口，不以服务端新增能力为前提。

### 2.2 Velopack 的能力边界

- Velopack 框架采用 MIT 许可证，有 JavaScript/Electron 接入方式；SDK 和构建工具需要锁定兼容版本。[仓库与许可证](https://github.com/velopack/velopack)、[JS 接入](https://docs.velopack.io/getting-started/javascript)。
- 差分包下载后重建完整发布包；缺少基包、差分不可用或重建失败时走全量回退。不能据此推断“只写变化的安装文件”。[更新流程](https://docs.velopack.io/integrating/overview)。
- Windows 更新替换 `current` 目录，并处理占用该目录的进程。首轮 P0 核对 `1.2.161`：旧进程退出后才展开完整包，不提供退出前预展开或文件级增量安装；慢盘收益仍需实测。详见 [P0 记录](./velopack-implementation-design.md#121-首轮-p0-结果2026-10-10)。[Windows 文档](https://docs.velopack.io/packaging/operating-systems/windows)。
- macOS 在应用更新步骤展开并替换 `.app`；Linux 支持 AppImage 替换。不能承诺所有平台退出后只做一次目录改名。[macOS 文档](https://docs.velopack.io/packaging/operating-systems/macos)、[Linux 文档](https://docs.velopack.io/packaging/operating-systems/linux)。
- GitHub Releases 是官方支持的发布源，可托管完整包、差分包与索引，无需实时计算差分的服务器。[发布说明](https://docs.velopack.io/distributing/self-hosting)。

上述链接是动态文档。P0 必须记录 SDK、`vpk`、平台 updater 的确切版本及对应源码 revision，核实 JS 绑定实际暴露的能力，不直接照搬 C# API。

## 3. 平台与安装格式范围

| 平台/安装类型 | 目标更新后端 | 首装与兼容性要求 |
| --- | --- | --- |
| Windows 用户级安装 x64/arm64 | Velopack | 优先验证；保留数据位置、协议、快捷方式、开机启动和任务栏身份 |
| Windows 系统级安装 x64/arm64 | 验证通过后 Velopack，否则保持 NSIS | 验证所选版本的 MSI/提权能力；不能静默转为用户级安装 |
| Windows portable | 本期保持现状 | 不因 SDK 支持便携更新而自动改变产品行为 |
| macOS x64/arm64 直接分发 | Velopack | 保留 bundle ID、entitlements、签名身份和公证；DMG 中必须是最终 Velopack 集成后的应用 |
| Linux AppImage x64/arm64 | Velopack | 保留 GLIBC/native binary 兼容流程，验证可执行权限、桌面入口和特权目录 |
| Linux deb/rpm | 外部包管理/手动包安装 | 应用仅提示并引导适当更新方式，不覆盖包管理器拥有的文件 |
| 开发态/无法识别的安装 | 禁止安装，允许受控检查 | 不根据操作系统直接认定已经由 Velopack 管理 |

矩阵是产品目标，不代表选定 SDK 的每个架构二进制已经验证。任何未通过 native addon、打包和真实安装测试的组合保留旧后端，不发布不可运行的替代包。

## 4. 客户端架构

### 4.1 服务与模块责任

继续由生命周期管理的 `AppUpdaterService` 负责定时器、偏好订阅、更新状态和 IpcApi 广播。与更新相关的辅助模块放在 `src/main/services/` 所属更新模块内，不新增主进程顶层目录。

内部仅保留三个必要分支：Velopack 安装、过渡期 legacy 安装、外部管理安装。每个进程只能激活一个安装后端；Velopack 的 delta 失败可以回退 Velopack 完整包，不能临时改用 NSIS 安装器覆盖 `current`。

统一逻辑操作为检查、下载、取消（若 SDK 支持）、安装及状态查询。能力差异通过状态中的 capabilities 表达，不伪造下载取消成功或把下载完成当作解压完成。SDK 原始类型只留在主进程，跨进程使用 `src/shared/` 的类型与 schema。

继续复用 `app.updater.*` 事件和现有命令路由；确需增加状态时同步修改 IpcApi schema、handler、preload/facade 和消费者，不另建 `ipcMain.handle` 通道。更新不属于 SQLite 业务数据，不新增 DataApi。

### 4.2 启动顺序

Velopack 的启动 hook 必须早于正常应用副作用；当前 `main.ts` 顶层导入 BootConfig、Application 和 serviceRegistry，因此仅在文件中插入一行调用不足以证明顺序正确。

设计一个很薄的启动入口：先运行独立的 Velopack hook，再加载现有应用启动模块。实现应在现有架构分类中安排，由 `electron.vite.config.ts` 指向入口；hook 本身属于更新能力模块，不依赖尚未启动的生命周期服务。

验收最终打包 JS：安装/更新 hook 执行时，不提前加载用户数据库、不抢占正常单实例锁、不初始化窗口。正常启动仍保持 BootConfig → userData 解析 → 路径注册 → 生命周期的既有顺序。不得通过模块静态导入提升意外提前执行整个应用。

SDK native `.node` 依赖必须 externalize，并在最终包中验证原生文件加载路径。不能仅以开发态能够 import 作为成功依据。

### 4.3 状态和退出协议

逻辑状态为：idle → checking → available → downloading/reconstructing → ready → applying；失败回到可恢复状态并保留错误原因。`ready` 仅表示达到 SDK 的可安装条件，不暗示安装目录已展开。

1. 安装前检查候选版本、渠道和安装类型，通过拟新增的 Application 退出 reservation 原子协调退出；当前 `canQuit()` 是私有方法，单独开放检查也不能消除竞态。
2. 串行化安装请求，固定本次候选版本；下载过程中更换渠道时，使旧请求结果失效。
3. 官方 JS 示例使用 `waitExitThenApplyUpdate()` 后 `app.quit()`，不能假设存在 C# 的一键重启 API。本项目要求 Application 清理成功后才通过独立 handoff 调用适配后的移交能力；能否满足这一顺序是 SDK 原型验收门槛，详见实施设计。
4. 处理安排更新后退出又被阻止的竞态。若 SDK 无法撤销待执行更新，应在启动 helper 前建立应用级退出协调，证明不会在用户仍操作时由 helper 超时强杀。
5. 保留“明确点击安装才应用”的产品规则；验证 JS SDK 是否能关闭启动时自动应用。不能关闭则作为阻断项，先解决上游能力再上线。
6. 重启参数只保留正常启动需要的参数，清除迁移和一次性操作参数，防止重复迁移或循环重启。

将 SDK 日志接入 `loggerService`。独立 updater 的日志位置和导出方式列入诊断；应用退出后的故障不能只依赖已经关闭的主进程日志。

### 4.4 路径与身份

Windows 的真正 EXE 可能移到 `current` 下。现有 `app.install` 定义是 EXE 所在目录，不能直接改为 Velopack 根目录而影响全部调用方。逐个审计调用方；确需区分时在路径注册表新增明确的安装根、启动器和更新日志路径，业务代码统一通过 `application.getPath()` 访问。

保留 app ID、macOS bundle ID、Windows AppUserModelID、协议注册和用户数据位置。global/cn 继续使用既有产品身份；Velopack `packId` 在 P0 确定并冻结，其命名不能造成 Windows 原有“两个 edition 替换同一安装”的行为意外变成并排安装。edition 切换是显式迁移，不随网络地区自动发生。

## 5. 更新服务与 GitHub Releases

### 5.1 分离策略服务和文件托管

生产继续用现有 feed 选择目标版本，并复用现有下载路由返回的 GitHub/GitCode 重定向决策；客户端按该源和固定版本定位新增的 Velopack 索引、完整包和差分包。索引是发布流水线生成的静态附件，不要求托管服务提供新 feed 或新增接口。客户端接入与测试契约见实施设计第 13.1 节；实际发布后的两平台附件下载及升级仍须验收，不能用本地升级成功代替线上验收。

客户端优先使用所选 JS SDK 已支持的 HTTP/source 能力，精确读取选定版本的静态索引。固定目标、自定义源和跨 tag 包地址是否可用须在 P0 验证：若绑定不支持，先评估 SDK 上游补齐；不悄悄改用“GitHub 最新版本”，也不把改造 release 服务作为默认解决办法。直接 GitHub source 仅用于无需现有目标选择策略的隔离原型。

GitHub API 匿名限流和地区连通性纳入测试。发布 Token 仅在 CI 使用，不随客户端分发；Cherry 的客户端标识等请求头仅发往策略服务，不应无条件传播到下载域名。

### 5.2 渠道约定

逻辑更新键为 `(edition, os, arch, releaseChannel, installKind)`。客户端复用 `AppEdition`、`SupportedPlatform` 和 `UpgradeChannel`。建议 Velopack channel 使用完整的隔离名称，例如 `global-win-x64-latest`、`cn-osx-arm64-rc`、`global-linux-x64-beta`，最终合法名称以锁定的 `vpk` 验证结果为准。

稳定/RC/Beta 沿用 `UpgradeChannel.LATEST/RC/BETA` 的 latest/rc/beta 值，不新增平行渠道类型；地区只影响镜像选择。测试计划关闭后不默认降级：等待更高的稳定版本，或走明确设计的手动降级流程。

索引校验必须拒绝跨 edition、跨系统、跨架构和不兼容安装类型的包。GitHub 的“Latest Release”标签不能替代这些判断。发行版本和预发布排序采用经过验证的 SemVer 规则，不使用字符串比较。

### 5.3 发布流水线

保留 electron-vite 编译与 electron-builder 应用目录生成能力，新增 `vpk` 封装，不同时迁移到 Electron Forge。

1. 在既有 release 精确提交和平台/edition 矩阵上构建，固定 Node、SDK、`vpk` 和原生依赖版本。
2. 获取同一渠道的已发布基包，验证来源和哈希；首版没有基包就只生成完整包。不能以尚未发布的 draft 作为用户已有基线。
3. 生成平台应用目录，保留当前 native binary 处理；按 Velopack 官方签名集成完成最终应用、helper 和安装器签名，签名后的内容再进入最终包/差分生成。macOS 验证最终 `.app` 公证和分发载体，不假设之前的签名仍有效。
4. 运行固定版本 `vpk pack`，产出首装文件、完整 `.nupkg`、可选 delta `.nupkg`、对应渠道索引；确切文件名由工具产物清单读取。
5. 更新 `scripts/release/edition.js`、产物校验和汇总脚本，使旧产物与 Velopack 产物均有封闭清单；同 Release 内按平台/edition/架构避免同名覆盖。
6. 各矩阵任务只暂存产物，统一发布任务上传现有 draft 并校验完整性。不能让各任务自行执行带 `--publish` 的上传命令，绕过现有审批或互相覆盖索引。
7. 经既有审批发布；发布前校验同 tag 的 legacy 与 Velopack 产物全部齐全。新索引必须指向真实 Release 附件；不要求 release 服务新增切换 API。上传失败不能发布半套版本，现有 feed 暴露时机仍遵循现有发布流程。
8. 保留支撑已发布索引的基包和差分链。清理前校验引用；缺少旧链时仍须存在可下载的目标完整包。

继续发布 release-history，并保留 legacy feed/安装器供过渡期用户使用。不是把现有 `latest.yml` 的 EXE URL 改成 Velopack Setup：旧 updater 传递的 NSIS 参数和安装目录语义不兼容。

## 6. 旧用户迁移

### 6.1 共同原则

使用一个桥接发行版本 B 和随后验证用版本 C，字母仅表示角色，不预定真实版本号。B 同时支持 legacy 检测和 Velopack 集成。沿用现有升级网关能力；若现有 feed 不能固定引导至 B，则后续过渡期 legacy 发行包继续携带桥接能力，允许跳过 B 的旧用户迁移，不要求服务端增加路由。

迁移前记录安装类型、程序位置、用户数据位置和原有启动入口。用户数据、数据库、附件、模型和工具链不放进可替换的程序目录，不借机改名或搬迁。迁移成功以“新安装身份正确且使用原数据启动成功”为准，而不是安装器退出码为零。

迁移状态必须持久化且可重入，明确区分准备、已安装、已验证、待清理、完成；重复启动不重复卸载。仅清理已确认属于旧安装的程序文件，不能对用户指定的整个父目录递归删除。

### 6.2 Windows NSIS → Velopack

1. 旧客户端通过原 electron-updater 升级到 B，保留现有 NSIS 参数兼容性。
2. B 下载并校验独立的 Velopack 迁移产物，明确展示一次性安装迁移。迁移是用户安装操作，不由普通退出或后台检查触发。
3. 独立、已签名的迁移协调程序等待应用正常退出，按探测到的安装范围调用新安装器；其具体实现先验证官方迁移工具是否覆盖 NSIS，不预设自动支持。
4. 优先采用独立目标目录准备新安装，保留旧程序作为失败退路。若相同注册身份/卸载条目不允许安全共存，必须先完成对应恢复设计，再上线该安装类型。
5. 新版校验安装身份、数据路径、单实例行为和启动入口；首次迁移尽量使用同版本应用内容，避免把数据 schema 变更与安装结构迁移绑在一起。
6. 清理旧安装前验证旧卸载器不会删除新快捷方式、协议和注册信息；必要时安排确定顺序的重新注册。不能盲目在新安装成功后运行旧卸载器。
7. 用户级先放量；系统级必须验证提权拒绝、多个 Windows 账号、安装目录权限后单独放量。不满足条件继续 legacy。

首次迁移仍可能很慢，性能收益主要从 Velopack 管理后的 B → C 更新验证。取消/失败应能继续使用旧安装；不把 NSIS 的旧 GUID 直接当作 Velopack packId 的替代品。

### 6.3 macOS 旧 `.app` → Velopack

优先验证原 updater 能否将包含 Velopack 集成的 B 应用通过现有签名 ZIP 路径安装到原位置，并在随后正常启动被识别为 Velopack 管理。旧 updater 的签名身份、bundle ID 和最终分发 ZIP 必须与真实 `.app` 一致。

若该转换受 SDK 元数据/布局限制，则采用明确提示的 DMG/PKG 迁移，不宣称可直接接管。分别验证 `/Applications`、用户 Applications、自定义位置、移动后的应用、提权拒绝以及只读 DMG 中直接运行。

保留签名、公证、entitlements 和 Keychain/系统权限身份；现有授权是否继承需实际验证。新 DMG 从最终 Velopack 应用构造，不能重新放入未集成 updater 的旧 bundle。App Sandbox/Mac App Store 不属于本方案。

### 6.4 Linux 旧 AppImage → Velopack

验证旧 updater 使用其支持的更新元数据替换为 B 的 Velopack AppImage 后，新 updater 能否识别正确布局。旧 feed 的哈希和大小必须来自实际发布的 B 文件，不混用构建中间产物。

不兼容时提示手动下载 B 并替换原文件；保留配置路径、文件位置和桌面启动入口。覆盖只读目录、跨文件系统临时目录、磁盘不足、缺少提权组件及可执行位丢失。不能承诺跨文件系统替换是一次原子重命名。

deb/rpm 不走这条迁移；若没有已配置的软件源，提供对应包下载指引，不展示无法完成更新的固定包管理命令。

## 7. 完整性、恢复与运维

| 故障 | 预期行为 |
| --- | --- |
| 下载中断、delta 基包缺失或损坏 | 按 SDK 能力重试或回退同后端完整包；旧安装保持可用 |
| 磁盘不足 | 尽可能在退出前检查所需临时空间，提示清理；安装中失败不能报告成功 |
| 文件被占用、权限被拒绝 | 不启动不完整新版；保留日志和明确恢复入口 |
| 更新过程中断电 | 验证所选版本恢复行为，必要时保留人工重装路径；未经验证不承诺自动回滚 |
| 新程序启动失败 | 记录 updater 与应用启动日志；有数据兼容保证才允许程序回退 |
| 新版已经执行数据库迁移 | 默认禁止自动降级；采用向前修复或经过验证的数据备份恢复流程 |
| 错误版本上线 | 使用现有发布/分发处置流程停止新下载；已校验缓存仍可离线安装，本期不提供即时远程撤销 |
| 镜像/渠道暂时不可用 | 有界重试并保留已安装版本，不跨 edition 或偷偷切预发布渠道 |

TLS、包哈希和代码签名各有不同作用；不能把同源下载的哈希当作发布者身份认证。P0 必须记录各平台 updater 实际执行的校验、签名失败行为和可信更新源约束，阻断损坏或非预期来源产物。

应用缓存清理不得清掉 SDK 需要的差分基包；不要沿用“关闭差分时可删安装缓存”的推论。日志不记录 Token、用户内容或完整敏感请求头。

已有 updater 日志和故障处理优先复用；自动回滚、启动健康确认等若非 SDK 原生能力，作为独立评估项，不在接入过程中隐式扩建一套更新框架。

## 8. 性能与功能验收

### 8.1 指标

对同一对版本、相同签名产物内容和相同设备比较 NSIS 与 Velopack，独立记录一次迁移和正常后续更新。

| 指标 | 定义 |
| --- | --- |
| 下载量 | 实际网络字节数，区分 delta 和完整包 |
| 准备耗时 | 开始下载到 SDK 报告可安装 |
| 退出耗时 | 点击安装到旧进程及相关子进程退出 |
| 安装耗时 | 旧主进程退出到启动新进程 |
| 可用等待 | 点击安装到新版主窗口可交互 |
| 磁盘成本 | 整个更新与退出后分别统计读写字节、文件操作数、临时空间峰值 |

使用健康 SSD、真实机械硬盘和受控慢 I/O 环境；故障硬盘的坏扇区/系统重试不作为软件可保证的性能。每个关键场景至少运行 10 次，报告中位数、最大值和原始数据；冷缓存/热缓存分开，不用少量样本宣称可靠 P95。

覆盖小代码变更、大依赖升级、Electron 升级和跨多个版本更新；`app.asar` 很小的代码变更也可能导致大文件重建，必须实际测量。

建议上线门槛（待 P0 基线确认，非当前实测结果）：Windows 慢盘常规更新的可用等待中位数至少降低 30%，最大值无明显退化；SSD 常规更新中位数退化不超过 10%。macOS/AppImage 也以相同设备基线确认无明显退化；若收益不足，保留旧后端并记录原因。

### 8.2 必测矩阵

- 平台/架构/edition：每个实际分发组合均进行真实安装和 B → C 更新，不能只测打包成功。
- 渠道：stable、rc、beta、关闭测试计划、跨版本、错误 edition/架构、同版本重复检查。
- 格式：Windows 用户级/系统级与 portable 隔离，macOS 各安装位置，Linux AppImage 与 deb/rpm 隔离。
- 运行态：正常退出、仍有 Agent/终端/native 子进程、迁移禁止退出、双击安装按钮、应用多实例、更新期间关机。
- 数据：自定义 userData、数据库/附件/知识库、系统凭据、既有 schema 迁移均保持正确。
- 网络与磁盘：断网、API 限流、镜像延迟、缺基包、损坏包、磁盘满、跨卷临时目录、拒绝提权。
- 系统集成：协议、桌面/开始菜单/Dock、开机启动、卸载入口、任务栏身份、macOS 授权。
- 恢复：在下载、包重建、应用替换等实际阶段中断进程；验证留下的状态及恢复步骤。

测试以结果契约为主：旧版是否仍能启动、目标版是否正确、数据是否保留、错误包是否被拒绝。不能只断言 SDK mock 被调用。平台原生更新在真实安装包/虚拟机快照中测，普通开发 Electron 实例不能替代。

## 9. 实施分期与交付物

| 阶段 | 改动与交付物 | 退出条件 |
| --- | --- | --- |
| P0 能力与性能原型 | 锁定 SDK/vpk；三平台两版样包；JS/source 能力表；签名与启动顺序实验；慢盘基线 | GitHub/托管 feed 可用；架构矩阵明确；证明性能方向有效，列明所有未支持组合 |
| P1 公共客户端 | 服务内部后端选择、启动 hook、状态/事件适配、路径和退出协调 | UI 行为一致，普通退出不安装，不抢数据库/单实例，后端互斥 |
| P2 发布接入 | 应用目录构建、vpk、签名、双格式产物清单、draft 汇总和镜像 | 原发布审批仍有效；所有索引引用有效且产物身份一致 |
| P3 Windows 迁移 | B 桥接、迁移恢复、用户级先行、系统级单独验证 | B → C 慢盘门槛通过，迁移失败不丢旧安装和数据 |
| P4 macOS/AppImage | 两平台桥接和手动迁移退路、权限/签名/桌面集成 | 各自通过完整矩阵后独立放量，不能被 Windows 成功代替 |
| P5 扩大与收尾 | 测试渠道 → 稳定小范围 → 扩大，迁移观测和运维手册 | 达到预先约定的覆盖与故障标准后再删除 legacy 分支 |

“小范围”优先使用现有测试渠道和明确选择参与的测试安装；仅在服务已有相应能力时使用用户级控量，不为本次接入新增灰度 API。GitHub Releases 不自带用户级灰度。停止新增迁移通过现有发布/渠道操作执行，不代表已完成迁移的客户端强制切回 NSIS，也不能即时撤回已下载缓存。

legacy feed 的保留期限依据仍活跃的旧安装覆盖和升级网关策略确定，不在首次 Velopack 发布后立即删除。新 Windows 安装默认切换也应晚于旧安装迁移验证。

## 10. 预期改动位置与待决策项

| 位置 | 后续实现责任 |
| --- | --- |
| `src/main/services/AppUpdaterService.ts` 与所属更新模块 | 后端选择、策略解析、状态、调度与 SDK 适配 |
| `src/main/main.ts`、`electron.vite.config.ts` | 早期 hook 和正常启动副作用隔离，native externalize |
| `src/main/core/application/Application.ts` | 仅在必要时补充更新退出协调，不绕过现有数据保护 |
| `src/main/core/paths/pathRegistry.ts` | 区分应用目录、安装根和固定启动入口 |
| `src/shared/` IPC schema、`src/main/ipc/handlers/app.ts`、现有 UI | 保持命令边界，补充能力与错误状态 |
| `package.json`、构建配置、`scripts/packaging/` | SDK/工具版本锁定、平台打包、签名和依赖运行库 |
| `.github/workflows/release.yml`、`scripts/release/` | 双格式产物、校验、上传、镜像与基包选择 |
| 托管更新服务（保持现状） | 复用现有 feed 和版本选择；无新增 endpoint、授权或 Velopack feed 要求 |

P0 结束前必须关闭的决策：具体 SDK/vpk 版本及各架构支持、JS 的 source/header/精确版本与自动应用控制、安装身份映射、系统级安装路径、NSIS 迁移工具能力、macOS/AppImage 接管方式、各平台最终签名步骤、故障恢复能力及性能门槛结果。

无法满足的能力先记录上游差距和选项，再决定调整范围；不能用未验证的“支持 delta”“目录替换”或“官方支持 Electron”作为上线依据。
