# 应用更新架构

## 概述

当前 Cherry Studio 客户端统一通过托管发布服务 `https://releases.cherry-ai.com` 检查更新。客户端只选择更新渠道，并发送应用、客户端、平台和地区信息；具体目标版本、灰度范围、国内外镜像、必经升级版本以及返回给 electron-updater 的清单都由发布服务决定。

客户端不会读取 `app-upgrade-config.json`、计算升级路径，也不会自行拼接 GitHub 或 GitCode 下载地址。

## 更新源配置

- 正式包使用 `electron-builder.yml` 中的 `publish.url`，electron-builder 会在打包时将其写入 `app-update.yml`。
- 开发构建设置 `forceDevUpdateConfig = true`，由 electron-updater 读取仓库根目录的 `dev-app-update.yml`。开发环境默认连接 `http://127.0.0.1:3378`。
- `AppUpdater` 不调用 electron-updater 的运行时更新源切换接口。修改生产环境基础地址需要更新构建配置并重新发布客户端。

## 更新渠道

客户端会请求以下 electron-updater 渠道之一：

- `latest`：只接收正式版。
- `rc`：由发布服务从该用户可见的 RC 和正式版中选择最高版本。
- `beta`：由发布服务从该用户可见的 Beta、RC 和正式版中选择最高版本。

测试渠道表示用户能够接受的最低稳定程度，不会把用户永久固定在某个预发布后缀上。

## 请求约定

每次检查更新前，客户端会设置以下请求头：

| 请求头 | 值 |
| --- | --- |
| `Client-Id` | 持久化客户端标识 |
| `App-Name` | 应用名称 |
| `App-Version` | 带 `v` 前缀的已安装版本 |
| `OS` | `process.platform` 的值 |
| `X-Region` | 中国为 `cn`，其他地区为 `global` |
| `User-Agent` | Cherry Studio 生成的 User-Agent |
| `Cache-Control` | `no-cache` |

客户端不发送 `X-Release-Channel`。electron-updater 当前选择的渠道决定请求 `latest`、`rc` 或 `beta` 清单。

## 检查流程

1. 未启用测试计划时使用 `latest`；启用后使用已保存的测试渠道，未保存时默认为 `rc`。
2. 根据 IP 地理位置确定请求地区。
3. 设置请求头和 electron-updater 渠道。
4. 调用 `checkForUpdates()`。
5. 由 electron-updater 处理发布服务返回的清单，并在存在更新时下载清单引用的安装包。

版本兼容门槛、分批灰度、目标版本和镜像选择均由发布服务负责。发布服务引用的清单和安装包必须保持可访问，但客户端不要求它们托管在特定平台。

## 容错行为

- Windows 便携版跳过更新检查。
- 发布服务没有可用版本时，electron-updater 按“没有更新”的正常流程处理。
- 网络或服务异常会被记录并结束本次检查；下次定时或手动检查仍使用相同的配置地址。
- IP 查询的兜底结果只影响地区请求头，不会改变更新服务地址。

## 发布操作

- 在托管发布服务中配置版本、兼容门槛、灰度规则和镜像。
- 确保服务返回的每份清单都引用可访问的发布安装包。
- 开发环境通过 `3378` 端口上的本地发布服务验证更新检查。
- 发布策略变化不要重新引入客户端版本路由或运行时更新源地址。

## 遗留配置

`app-upgrade-config.json` 仅作为已发布旧客户端的兼容遗留保留。当前客户端不会读取它，本仓库也不再包含更新它的自动化。文件中的结构、版本和中转升级示例都不能视为当前发布策略；如需退役该遗留文件，必须另行制定仍依赖它的旧客户端迁移方案。
