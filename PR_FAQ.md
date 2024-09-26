# FAQ 文档
本文档适用于：产品手册、官网页面、课程测验、现场 Q&A。

## 问题1：Cherry Studio 支持哪些操作系统？
- **答案**：Cherry Studio 支持 Windows、Mac 和 Linux 操作系统。

## 问题2：Cherry Studio 的主要功能有哪些？
- **答案**：Cherry Studio 的主要功能包括：
  1. 支持多个 LLM 提供商
  2. 允许创建多个助手
  3. 支持创建多个主题
  4. 允许在同一对话中使用多个模型来回答问题
  5. 支持拖放排序
  6. 代码高亮
  7. Mermaid 图表支持

## 问题3：Cherry Studio 的主要目录结构是怎样的？
- **答案**：Cherry Studio 的主要目录结构如下：
  - `/src`: 主要源代码目录
  - `/build`: 构建相关文件
  - `/docs`: 文档目录
  - `/resources`: 资源文件目录
  - `/scripts`: 脚本文件目录

## 问题4：如何在 Windows 环境下 fork Cherry Studio 并修改部分功能？
- **答案**：在 Windows 环境下 fork Cherry Studio 并修改部分功能的步骤如下：
  1. 在 GitHub 上 fork Cherry Studio 仓库
  2. 克隆 fork 的仓库到本地：`git clone https://github.com/your-username/cherry-studio.git`
  3. 进入项目目录：`cd cherry-studio`
  4. 安装依赖：`yarn install`
  5. 修改所需的功能代码
  6. 测试修改：`yarn dev`
  7. 提交修改：`git add .` 和 `git commit -m "描述你的修改"`
  8. 推送到你的 fork 仓库：`git push origin main`

## 问题5：Cherry Studio 使用了哪些主要技术栈？
- **答案**：Cherry Studio 主要使用了以下技术栈：
  - TypeScript
  - SCSS
  - Electron
  - Vite
  - Sequelize

## 问题6：如何贡献代码到 Cherry Studio 项目？
- **答案**：贡献代码到 Cherry Studio 项目的步骤如下：
  1. Fork 项目仓库
  2. 创建你的特性分支：`git checkout -b feature/AmazingFeature`
  3. 提交你的修改：`git commit -m 'Add some AmazingFeature'`
  4. 推送到分支：`git push origin feature/AmazingFeature`
  5. 打开一个 Pull Request

## 问题7：Cherry Studio 的 `/src` 目录主要包含哪些内容？
- **答案**：Cherry Studio 的 `/src` 目录主要包含以下内容：
  - 主进程代码（Electron 主进程）
  - 渲染进程代码（用户界面）
  - 组件
  - 工具函数
  - 状态管理
  - 样式文件

## 问题8：如何在 Cherry Studio 中添加新的 LLM 提供商？
- **答案**：要在 Cherry Studio 中添加新的 LLM 提供商，你需要：
  1. 在 `/src/services` 或类似目录下创建新的服务文件
  2. 实现与新 LLM 提供商 API 的集成
  3. 在用户界面中添加新提供商的选项
  4. 更新配置和状态管理以支持新提供商

## 问题9：Cherry Studio 的构建过程是怎样的？
- **答案**：Cherry Studio 的构建过程主要包括：
  1. 使用 Vite 构建前端资源
  2. 使用 Electron Builder 打包桌面应用
  3. 根据不同平台（Windows、Mac、Linux）生成相应的安装包

## 问题10：如何在 Cherry Studio 中实现新的 UI 主题？
- **答案**：在 Cherry Studio 中实现新的 UI 主题的步骤：
  1. 在 `/src/styles` 目录下创建新的主题 SCSS 文件
  2. 定义新主题的颜色变量和样式
  3. 在主样式文件中导入新主题
  4. 更新主题切换逻辑以包含新主题
  5. 在用户界面中添加新主题的选项

## 问题11：Cherry Studio 如何处理多语言支持？
- **答案**：Cherry Studio 可能通过以下方式处理多语言支持：
  1. 使用 i18n 库进行国际化
  2. 在 `/src/locales` 或类似目录下存储不同语言的翻译文件
  3. 实现语言切换功能
  4. 在组件中使用翻译函数或组件来显示多语言文本

## 问题12：如何为 Cherry Studio 编写单元测试？
- **答案**：为 Cherry Studio 编写单元测试的步骤：
  1. 在 `/tests` 目录下创建测试文件
  2. 使用测试框架（如 Jest）编写测试用例
  3. 模拟 Electron 环境和其他依赖
  4. 运行测试命令：`yarn test`
  5. 确保测试覆盖主要功能和组件
