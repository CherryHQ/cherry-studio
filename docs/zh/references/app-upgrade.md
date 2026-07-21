# 更新配置系统设计文档

> **兼容性说明**：当前客户端已经不再读取 `app-upgrade-config.json`。该文件和自动化工作流仅为已经发布、仍依赖旧配置的客户端保留，请勿直接删除。

当前客户端统一通过 `https://releases.cherry-ai.com` 检查更新。客户端只负责选择 `latest`、`rc` 或 `beta` 清单，并发送 `App-Version`、`OS`、`Client-Id` 和 `X-Region`；客户端是默认请求方，因此不发送 `X-Release-Channel`。具体版本、国内外镜像、灰度范围和中转版本由发布服务决定。

测试通道表示用户愿意接受的最低稳定程度，而不是把用户永久固定在某种后缀：Beta 通道会从该用户可见的 Beta、RC、正式版中选择最高版本，RC 通道会从 RC、正式版中选择最高版本，稳定通道只接收正式版。服务端会按最终版本返回对应的真实清单，因此 Beta 用户可以自然升级到 RC 和正式版。

## 旧客户端背景

当前 AppUpdater 直接请求 GitHub API 获取 beta 和 rc 的更新信息。为了支持国内用户，需要根据 IP 地理位置，分别从 GitHub/GitCode 获取一个固定的 JSON 配置文件，该文件包含所有渠道的更新地址。

## 设计目标

1. 支持根据 IP 地理位置选择不同的配置源（GitHub/GitCode）
2. 支持版本兼容性控制（如 v1.x 以下必须先升级到 v1.7.0 才能升级到 v2.0）
3. 易于扩展，支持未来多个主版本的升级路径（v1.6 → v1.7 → v2.0 → v2.8 → v3.0）
4. 保持与现有 electron-updater 机制的兼容性

## 当前版本策略

- **v1.7.x** 是 1.x 系列的最后版本
- **v1.7.0 以下**的用户必须先升级到 v1.7.0（或更高的 1.7.x 版本）
- **v1.7.0 及以上**的用户可以直接升级到 v2.x.x

## 自动化工作流

`x-files/app-upgrade-config/app-upgrade-config.json` 由 [`Update App Upgrade Config`](../../.github/workflows/update-app-upgrade-config.yml) workflow 自动同步。工作流会调用 [`scripts/update-app-upgrade-config.ts`](../../scripts/update-app-upgrade-config.ts) 脚本，根据指定 tag 更新 `x-files/app-upgrade-config` 分支上的配置文件。

### 触发条件

- **Release 事件（`release: released/prereleased`）**  
  - Draft release 会被忽略。  
  - 当 GitHub 将 release 标记为 *prerelease* 时，tag 必须包含 `-beta`/`-rc`（可带序号），否则直接跳过。  
  - 当 release 标记为稳定版时，tag 必须与 GitHub API 返回的最新稳定版本一致，防止发布历史 tag 时意外挂起工作流。  
  - 满足上述条件后，工作流会根据语义化版本判断渠道（`latest`/`beta`/`rc`），并通过 `IS_PRERELEASE` 传递给脚本。
- **手动触发（`workflow_dispatch`）**  
  - 必填：`tag`（例：`v2.0.1`）；选填：`is_prerelease`（默认 `false`）。  
  - 当 `is_prerelease=true` 时，同样要求 tag 带有 beta/rc 后缀。  
  - 手动运行仍会请求 GitHub 最新 release 信息，用于在 PR 说明中标注该 tag 是否是最新稳定版。

### 工作流步骤

1. **检查与元数据准备**：`Check if should proceed` 和 `Prepare metadata` 步骤会计算 tag、prerelease 标志、是否最新版本以及用于分支名的 `safe_tag`。若任意校验失败，工作流立即退出。
2. **检出分支**：默认分支被检出到 `main/`，长期维护的 `x-files/app-upgrade-config` 分支则在 `cs/` 中，所有改动都发生在 `cs/`。
3. **安装工具链**：安装 Node.js 22、启用 Corepack，并在 `main/` 目录执行 `pnpm install --frozen-lockfile`。
4. **运行更新脚本**：执行 `pnpm tsx scripts/update-app-upgrade-config.ts --tag <tag> --config ../cs/app-upgrade-config.json --is-prerelease <flag>`。  
   - 脚本会标准化 tag（去掉 `v` 前缀等）、识别渠道、加载 `config/app-upgrade-segments.json` 中的分段规则。  
   - 校验 prerelease 标志与语义后缀是否匹配、强制锁定的 segment 是否满足、生成镜像的下载地址，并检查 release 是否已经在 GitHub/GitCode 可用（latest 渠道在 GitCode 不可用时会回退到 `https://releases.cherry-ai.com`）。  
   - 更新对应的渠道配置后，脚本会按 semver 排序写回 JSON，并刷新 `lastUpdated`。
5. **检测变更并创建 PR**：若 `cs/app-upgrade-config.json` 有变更，则创建 `chore/update-app-upgrade-config/<safe_tag>` 分支，提交信息为 `🤖 chore: sync app-upgrade-config for <tag>`，并向 `x-files/app-upgrade-config` 提 PR；无变更则输出提示。

### 手动触发指南

1. 进入 Cherry Studio 仓库的 GitHub **Actions** 页面，选择 **Update App Upgrade Config** 工作流。
2. 点击 **Run workflow**，保持默认分支（通常为 `main`），填写 `tag`（如 `v2.1.0`）。  
3. 只有在 tag 带 `-beta`/`-rc` 后缀时才勾选 `is_prerelease`，稳定版保持默认。  
4. 启动运行并等待完成，随后到 `x-files/app-upgrade-config` 分支的 PR 查看 `app-upgrade-config.json` 的变更并在验证后合并。

## JSON 配置文件格式

### 文件位置

- **GitHub**: `https://raw.githubusercontent.com/CherryHQ/cherry-studio/refs/heads/x-files/app-upgrade-config/app-upgrade-config.json`
- **GitCode**: `https://gitcode.com/CherryHQ/cherry-studio/raw/x-files/app-upgrade-config/app-upgrade-config.json`

**说明**：两个镜像源提供相同的配置文件，统一托管在 `x-files/app-upgrade-config` 分支上。客户端根据 IP 地理位置自动选择最优镜像源。

### 配置结构（当前实际配置）

```json
{
  "lastUpdated": "2025-01-05T00:00:00Z",
  "versions": {
    "1.6.7": {
      "minCompatibleVersion": "1.0.0",
      "description": "Last stable v1.7.x release - required intermediate version for users below v1.7",
      "channels": {
        "latest": {
          "version": "1.6.7",
          "feedUrls": {
            "github": "https://github.com/CherryHQ/cherry-studio/releases/download/v1.6.7",
            "gitcode": "https://gitcode.com/CherryHQ/cherry-studio/releases/download/v1.6.7"
          }
        },
        "rc": {
          "version": "1.6.0-rc.5",
          "feedUrls": {
            "github": "https://github.com/CherryHQ/cherry-studio/releases/download/v1.6.0-rc.5",
            "gitcode": "https://github.com/CherryHQ/cherry-studio/releases/download/v1.6.0-rc.5"
          }
        },
        "beta": {
          "version": "1.6.7-beta.3",
          "feedUrls": {
            "github": "https://github.com/CherryHQ/cherry-studio/releases/download/v1.7.0-beta.3",
            "gitcode": "https://github.com/CherryHQ/cherry-studio/releases/download/v1.7.0-beta.3"
          }
        }
      }
    },
    "2.0.0": {
      "minCompatibleVersion": "1.7.0",
      "description": "Major release v2.0 - required intermediate version for v2.x upgrades",
      "channels": {
        "latest": null,
        "rc": null,
        "beta": null
      }
    }
  }
}
```

### 未来扩展示例

当需要发布 v3.0 时，如果需要强制用户先升级到 v2.8，可以添加：

```json
{
  "2.8.0": {
    "minCompatibleVersion": "2.0.0",
    "description": "Stable v2.8 - required for v3 upgrade",
    "channels": {
      "latest": {
        "version": "2.8.0",
        "feedUrls": {
          "github": "https://github.com/CherryHQ/cherry-studio/releases/download/v2.8.0",
          "gitcode": "https://gitcode.com/CherryHQ/cherry-studio/releases/download/v2.8.0"
        }
      },
      "rc": null,
      "beta": null
    }
  },
  "3.0.0": {
    "minCompatibleVersion": "2.8.0",
    "description": "Major release v3.0",
    "channels": {
      "latest": {
        "version": "3.0.0",
        "feedUrls": {
          "github": "https://github.com/CherryHQ/cherry-studio/releases/latest",
          "gitcode": "https://gitcode.com/CherryHQ/cherry-studio/releases/latest"
        }
      },
      "rc": {
        "version": "3.0.0-rc.1",
        "feedUrls": {
          "github": "https://github.com/CherryHQ/cherry-studio/releases/download/v3.0.0-rc.1",
          "gitcode": "https://gitcode.com/CherryHQ/cherry-studio/releases/download/v3.0.0-rc.1"
        }
      },
      "beta": null
    }
  }
}
```

### 字段说明

- `lastUpdated`: 配置文件最后更新时间（ISO 8601 格式）
- `versions`: 版本配置对象，key 为版本号，按语义化版本排序
  - `minCompatibleVersion`: 可以升级到此版本的最低兼容版本
  - `description`: 版本描述
  - `channels`: 更新渠道配置
    - `latest`: 稳定版渠道
    - `rc`: Release Candidate 渠道
    - `beta`: Beta 测试渠道
    - 每个渠道包含：
      - `version`: 该渠道的版本号
      - `feedUrls`: 多镜像源 URL 配置
        - `github`: GitHub 镜像源的 electron-updater feed URL
        - `gitcode`: GitCode 镜像源的 electron-updater feed URL
  - `metadata`: 自动化匹配所需的稳定标识
    - `segmentId`: 来自 `config/app-upgrade-segments.json` 的段位 ID
    - `segmentType`: 可选字段（`legacy` | `breaking` | `latest`），便于文档/调试

## TypeScript 类型定义

```typescript
// 镜像源枚举
enum UpdateMirror {
  GITHUB = 'github',
  GITCODE = 'gitcode'
}

interface UpdateConfig {
  lastUpdated: string
  versions: {
    [versionKey: string]: VersionConfig
  }
}

interface VersionConfig {
  minCompatibleVersion: string
  description: string
  channels: {
    latest: ChannelConfig | null
    rc: ChannelConfig | null
    beta: ChannelConfig | null
  }
  metadata?: {
    segmentId: string
    segmentType?: 'legacy' | 'breaking' | 'latest'
  }
}

interface ChannelConfig {
  version: string
  feedUrls: Record<UpdateMirror, string>
  // 等同于:
  // feedUrls: {
  //   github: string
  //   gitcode: string
  // }
}
```

## 段位元数据（Break Change 标记）

- 所有段位定义（如 `legacy-v1`、`gateway-v2` 等）集中在 `config/app-upgrade-segments.json`，用于描述匹配范围、`segmentId`、`segmentType`、默认 `minCompatibleVersion/description` 以及各渠道的 URL 模板。
- `versions` 下的每个节点都会带上 `metadata.segmentId`。自动脚本始终依据该 ID 来定位并更新条目，即便 key 从 `2.1.5` 切换到 `2.1.6` 也不会错位。
- 如果某段需要锁死在特定版本（例如 `2.0.0` 的 break change），可在段定义中设置 `segmentType: "breaking"` 并提供 `lockedVersion`，脚本在遇到不匹配的 tag 时会短路报错，保证升级路径安全。
- 面对未来新的断层（例如 `3.0.0`），只需要在段定义里新增一段，自动化即可识别并更新。

## 自动化工作流

`.github/workflows/update-app-upgrade-config.yml` 会在 GitHub Release（包含正常发布与 Pre Release）触发：

1. 同时 Checkout 仓库默认分支（用于脚本）和 `x-files/app-upgrade-config` 分支（真实托管配置的分支）。
2. 在默认分支目录执行 `pnpm tsx scripts/update-app-upgrade-config.ts --tag <tag> --config ../cs/app-upgrade-config.json`，直接重写 `x-files/app-upgrade-config` 分支里的配置文件。
3. 如果 `app-upgrade-config.json` 有变化，则通过 `peter-evans/create-pull-request` 自动创建一个指向 `x-files/app-upgrade-config` 的 PR，Diff 仅包含该文件。

如需本地调试，可执行 `pnpm update:upgrade-config --tag v2.1.6 --config ../cs/app-upgrade-config.json`（加 `--dry-run` 仅打印结果）来复现 CI 行为。若需要暂时跳过 GitHub/GitCode Release 页面是否就绪的校验，可在 `--dry-run` 的同时附加 `--skip-release-checks`。不加 `--config` 时默认更新当前工作目录（通常是 main 分支）下的副本，方便文档/审查。

## 版本匹配逻辑

### 算法流程

1. 获取用户当前版本（`currentVersion`）和请求的渠道（`requestedChannel`）
2. 获取配置文件中所有版本号，按语义化版本从大到小排序
3. 遍历排序后的版本列表：
   - 检查 `currentVersion >= minCompatibleVersion`
   - 检查请求的 `channel` 是否存在且不为 `null`
   - 如果满足条件，返回该渠道配置
4. 如果没有找到匹配版本，返回 `null`

### 伪代码实现

```typescript
function findCompatibleVersion(
  currentVersion: string,
  requestedChannel: UpgradeChannel,
  config: UpdateConfig
): ChannelConfig | null {
  // 获取所有版本号并从大到小排序
  const versions = Object.keys(config.versions).sort(semver.rcompare)

  for (const versionKey of versions) {
    const versionConfig = config.versions[versionKey]
    const channelConfig = versionConfig.channels[requestedChannel]

    // 检查版本兼容性和渠道可用性
    if (
      semver.gte(currentVersion, versionConfig.minCompatibleVersion) &&
      channelConfig !== null
    ) {
      return channelConfig
    }
  }

  return null // 没有找到兼容版本
}
```

## 升级路径示例

### 场景 1: v1.6.5 用户升级（低于 1.7）

- **当前版本**: 1.6.5
- **请求渠道**: latest
- **匹配结果**: 1.7.0
- **原因**: 1.6.5 >= 0.0.0（满足 1.7.0 的 minCompatibleVersion），但不满足 2.0.0 的 minCompatibleVersion (1.7.0)
- **操作**: 提示用户升级到 1.7.0，这是升级到 v2.x 的必要中间版本

### 场景 2: v1.6.5 用户请求 rc/beta

- **当前版本**: 1.6.5
- **请求渠道**: rc 或 beta
- **匹配结果**: 1.7.0 (latest)
- **原因**: 1.7.0 版本不提供 rc/beta 渠道（值为 null）
- **操作**: 升级到 1.7.0 稳定版

### 场景 3: v1.7.0 用户升级到最新版

- **当前版本**: 1.7.0
- **请求渠道**: latest
- **匹配结果**: 2.0.0
- **原因**: 1.7.0 >= 1.7.0（满足 2.0.0 的 minCompatibleVersion）
- **操作**: 直接升级到 2.0.0（当前最新稳定版）

### 场景 4: v1.7.2 用户升级到 RC 版本

- **当前版本**: 1.7.2
- **请求渠道**: rc
- **匹配结果**: 2.0.0-rc.1
- **原因**: 1.7.2 >= 1.7.0（满足 2.0.0 的 minCompatibleVersion），且 rc 渠道存在
- **操作**: 升级到 2.0.0-rc.1

### 场景 5: v1.7.0 用户升级到 Beta 版本

- **当前版本**: 1.7.0
- **请求渠道**: beta
- **匹配结果**: 2.0.0-beta.1
- **原因**: 1.7.0 >= 1.7.0，且 beta 渠道存在
- **操作**: 升级到 2.0.0-beta.1

### 场景 6: v2.5.0 用户升级（未来）

假设已添加 v2.8.0 和 v3.0.0 配置：
- **当前版本**: 2.5.0
- **请求渠道**: latest
- **匹配结果**: 2.8.0
- **原因**: 2.5.0 >= 2.0.0（满足 2.8.0 的 minCompatibleVersion），但不满足 3.0.0 的要求
- **操作**: 提示用户升级到 2.8.0，这是升级到 v3.x 的必要中间版本

## 当前客户端实现

客户端不再在 TypeScript 中保存或切换更新服务地址，也不会调用 electron-updater 的运行时地址切换接口。

- 正式包使用 `electron-builder.yml` 的 `publish.url`。打包时 electron-builder 会把它写入随应用发布的 `app-update.yml`。
- 开发模式设置了 `forceDevUpdateConfig = true`，由 electron-updater 读取项目根目录的 `dev-app-update.yml`。
- 正式包默认连接 `https://releases.cherry-ai.com`；开发模式默认连接本地 Docker 的 `http://127.0.0.1:3378`。两者都由配置文件管理，不要重新增加运行时地址常量。

每次检查更新前，`AppUpdater` 只执行以下工作：

1. 根据测试计划选择 `latest`、`rc` 或 `beta` 清单。
2. 根据 IP 判断 `X-Region` 为 `cn` 或 `global`。
3. 设置 `App-Version`、`OS`、`Client-Id`、`App-Name` 和区域请求头。
4. 设置 electron-updater 的 channel，然后调用 `checkForUpdates()`。

具体目标版本、国内外镜像、灰度分组和必经版本都由发布服务决定。客户端不读取旧的 `app-upgrade-config.json`，也不自行拼接 GitHub 或 GitCode 下载地址。

## 当前容错策略

1. IP 查询失败时由 IP 服务自身的默认结果决定区域，更新地址不变。
2. 更新服务没有可用版本时，按 electron-updater 的“没有更新”流程处理。
3. 网络异常时记录错误并结束本次检查，下次检查仍使用配置文件中的同一服务地址。

## GitHub Release 要求

为支持中间版本升级，需要保留以下文件：

- **v1.7.0 release** 及其 latest*.yml 文件（作为 v1.7 以下用户的升级目标）
- 未来如需强制中间版本（如 v2.8.0），需要保留对应的 release 和 latest*.yml 文件
- 各版本的完整安装包

### 当前需要的 Release

| 版本 | 用途 | 必须保留 |
|------|------|---------|
| v1.7.0 | 1.7 以下用户的升级目标 | ✅ 是 |
| v2.0.0-rc.1 | RC 测试渠道 | ❌ 可选 |
| v2.0.0-beta.1 | Beta 测试渠道 | ❌ 可选 |
| latest | 最新稳定版（自动） | ✅ 是 |

## 优势

1. **灵活性**: 支持任意复杂的升级路径
2. **可扩展性**: 新增版本只需在配置文件中添加新条目
3. **可维护性**: 配置与代码分离，无需发版即可调整升级策略
4. **多源支持**: 自动根据地理位置选择最优配置源
5. **版本控制**: 强制中间版本升级，确保数据迁移和兼容性

## 未来扩展

- 支持更细粒度的版本范围控制（如 `>=1.5.0 <1.8.0`）
- 支持多步升级路径提示（如提示用户需要 1.5 → 1.8 → 2.0）
- 支持 A/B 测试和灰度发布
- 支持配置文件的本地缓存和过期策略
