# 更新配置系统设计文档

> **兼容性说明**：当前客户端已经不再读取 `app-upgrade-config.json`。该文件仅作为旧版本客户端的兼容遗留保留，本仓库不再自动更新它。

当前客户端统一通过 `https://releases.cherry-ai.com` 检查更新。客户端只负责选择 `latest`、`rc` 或 `beta` 清单，并发送 `App-Version`、`OS`、`Client-Id` 和 `X-Region`；客户端是默认请求方，因此不发送 `X-Release-Channel`。具体版本、国内外镜像、灰度范围和中转版本由发布服务决定。

测试通道表示用户愿意接受的最低稳定程度，而不是把用户永久固定在某种后缀：Beta 通道会从该用户可见的 Beta、RC、正式版中选择最高版本，RC 通道会从 RC、正式版中选择最高版本，稳定通道只接收正式版。服务端会按最终版本返回对应的真实清单，因此 Beta 用户可以自然升级到 RC 和正式版。

## 旧客户端背景

旧版 AppUpdater 会根据 IP 地理位置，从 GitHub 或 GitCode 获取固定的 JSON 配置文件，其中包含各渠道的更新地址。这里保留相关说明，仅用于解释旧客户端的升级路径。

## 设计目标

1. 支持根据 IP 地理位置选择不同的配置源（GitHub/GitCode）
2. 支持版本兼容性控制（如 v1.x 以下必须先升级到 v1.7.0 才能升级到 v2.0）
3. 易于扩展，支持未来多个主版本的升级路径（v1.6 → v1.7 → v2.0 → v2.8 → v3.0）
4. 保持与现有 electron-updater 机制的兼容性

## 当前版本策略

- **v1.7.x** 是 1.x 系列的最后版本
- **v1.7.0 以下**的用户必须先升级到 v1.7.0（或更高的 1.7.x 版本）
- **v1.7.0 及以上**的用户可以直接升级到 v2.x.x

## 旧配置状态

`x-files/app-upgrade-config` 分支及其镜像上的 `app-upgrade-config.json` 仅为已经发布的旧客户端保留。本仓库不再提供更新它们的 workflow、脚本或 package 命令；如需退役这些旧文件，必须另行制定旧客户端迁移方案。

## JSON 配置文件格式

### 文件位置

- **GitHub**: `https://raw.githubusercontent.com/CherryHQ/cherry-studio/refs/heads/x-files/app-upgrade-config/app-upgrade-config.json`
- **GitCode**: `https://gitcode.com/CherryHQ/cherry-studio/raw/x-files/app-upgrade-config/app-upgrade-config.json`

**说明**：两个镜像源提供相同的配置文件，统一托管在 `x-files/app-upgrade-config` 分支上。旧客户端根据 IP 地理位置选择镜像源。

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
  - `metadata`: 历史段位信息
    - `segmentId`: 遗留段位标识
    - `segmentType`: 可选的遗留标记（`legacy` | `breaking` | `latest`）

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

## 遗留段位元数据

配置条目中可能仍包含由已删除自动化生成的 `metadata.segmentId` 和 `metadata.segmentType`。它们只是保留在旧配置中的历史数据，当前客户端不会读取。

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
