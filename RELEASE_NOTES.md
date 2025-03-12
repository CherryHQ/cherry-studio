# Cherry Studio v1.0.7 版本更新内容

## 1. 智能体emoji功能 🎨
- **表情头像**：现在可以使用emoji表情符号作为智能体头像
- **智能生成**：系统会根据智能体名称或描述自动生成匹配的emoji
- **单一emoji优化**：改进了算法，确保只使用单个emoji字符作为图标，防止多个emoji组合
- **手动刷新**：添加了刷新按钮，可随时重新生成更合适的emoji

## 2. 智能体分组管理 📚
- **分类管理**：支持创建多个智能体&话题分组，更有效地管理不同用途的AI助手
- **拖放功能**：提供直观的拖放界面，轻松调整智能体位置和组织结构
- **空间优化**：分组支持展开/折叠功能，提高界面清晰度
- **自定义命名**：可以为每个分组设置个性化名称，便于识别
- **复制功能**：支持话题复制(Duplicate)，快速创建相同内容的新话题，避免重复输入
- **移动功能**：实现话题移动(Move to)功能，可将话题灵活地在不同分组间转移，实现更自由的组织管理

## 3. 构建优化 🔧
- **自动构建**：新增 GitHub Actions 自动构建流程
- **多平台支持**：
  - macOS：支持 ARM64 架构(M系列芯片)和 x64 架构(Intel芯片)
  - Windows：支持 x64 架构

## 4. 其他改进 ⚡️
- **性能优化**：提升了应用整体运行效率
- **界面优化**：改进了用户界面的视觉体验
- **稳定性提升**：修复了已知问题，提高了应用稳定性

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
