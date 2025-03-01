# Cherry Studio v1.0.1 发布说明

## 新特性和改进

- **助手分组管理功能**：
  - 支持创建多个助手分组，便于分类管理不同用途的AI助手
  - 提供直观的分组界面，支持拖放操作重新组织助手
  - 分组支持展开/折叠功能，优化空间利用
  - 支持为分组设置名称和图标
- 修复类型错误和ESLint问题
- 优化全局错误处理逻辑
- 增强类型安全性

## 修复

- 修复了"TypeError: Cannot read properties of undefined (reading 'map')"错误
- 实现了安全数组和对象访问工具函数，防止空引用
- 在Assistant类型定义中添加createTime和updateTime属性
- 在默认助手对象中添加必需的type属性

## 安装包

### macOS
- [Intel芯片版 (x64) DMG](https://github.com/SiinXu/cherry-studio/releases/download/v1.0.1/Cherry.Studio-1.0.1-x64.dmg)
- [M系列芯片版 (arm64) DMG](https://github.com/SiinXu/cherry-studio/releases/download/v1.0.1/Cherry.Studio-1.0.1-arm64.dmg)
- [Intel芯片版 (x64) ZIP](https://github.com/SiinXu/cherry-studio/releases/download/v1.0.1/Cherry.Studio-1.0.1-x64.zip)
- [M系列芯片版 (arm64) ZIP](https://github.com/SiinXu/cherry-studio/releases/download/v1.0.1/Cherry.Studio-1.0.1-arm64.zip)

### Windows (即将提供)
- Windows安装包将在后续版本中提供

## 重要更新说明

### 助手分组管理
这个版本引入了全新的助手分组管理功能，让您能够更有效地组织和管理不同类型的AI助手：

- **创建分组**：可以创建多个分组，如"工作"、"学习"、"娱乐"等
- **分组管理**：支持将助手拖放到不同分组中，轻松调整组织结构
- **快速访问**：通过折叠/展开分组，提高界面清晰度和导航效率
- **个性化**：为每个分组设置独特的名称，便于识别

### 健壮性提升
通过实现全面的安全数组和对象访问工具函数，有效防止了"Cannot read properties of undefined"类型的错误，显著提高了应用的稳定性。

## 打包信息
- 构建时间: 2025-03-01
- 版本号: 1.0.1
