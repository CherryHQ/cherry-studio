# 应用更新架构

## 概述

当前 Cherry Studio 客户端统一通过托管发布服务 `https://releases.cherryai.com.cn` 检查更新。客户端选择更新渠道，并发送应用、客户端、平台和地区信息。

## 更新源配置

- 正式包使用 `electron-builder.yml` 中的 `publish.url`，electron-builder 会在打包时将其写入 `app-update.yml`。
- 开发构建设置 `forceDevUpdateConfig = true`，由 electron-updater 读取仓库根目录的 `dev-app-update.yml`。开发环境默认连接 `http://127.0.0.1:3378`。
- 生产环境基础地址的变更通过构建配置生效，并随新构建的客户端发布。

## 更新渠道

客户端会请求以下 electron-updater 渠道之一：

- `latest`：正式版渠道。
- `rc`：候选发布版渠道。
- `beta`：测试版渠道。

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

electron-updater 当前选择的渠道决定客户端请求 `latest`、`rc` 或 `beta` 清单。
