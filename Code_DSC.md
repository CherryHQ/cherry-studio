## Cherry Studio目录结构和功能

### 1. `/src`: 主要源代码目录
   - ** `/main`**: Electron主进程相关代码
     - 负责应用的生命周期管理、窗口创建、IPC通信等
   - ** `/renderer`**: Electron渲染进程相关代码
     - 包含用户界面的实现，使用TypeScript和SCSS
   - ** `/preload`**: 预加载脚本
     - 用于在渲染进程中安全地暴露主进程功能
   - ** `/components`**: React组件
     - 可复用的UI组件，如对话框、输入框等
   - ** `/pages`**: 应用的主要页面
     - 如聊天界面、设置页面等
   - ** `/store`**: 状态管理
     - 可能使用Redux或MobX来管理应用状态
   - ** `/utils`**: 工具函数
     - 包含各种辅助函数和工具类
   - ** `/styles`**: 全局样式文件
     - 包含SCSS文件，定义全局样式和主题

### 2. `/public`: 静态资源目录
   - 包含图标、字体等静态文件

### 3. `/electron`: Electron相关配置
   - 包含Electron的构建和打包配置

### 4. `/scripts`: 构建和开发脚本
   - 包含npm脚本，用于开发、构建和部署

### 5. `/types`: TypeScript类型定义
   - 包含自定义的类型定义文件

### 6. `/tests`: 测试文件目录
   - 包含单元测试和集成测试

### 7. `/docs`: 文档目录
   - 包含项目文档、API文档等

### 8. `/config`: 配置文件目录
   - 包含各种配置文件，如webpack配置、环境变量等

### 9. `/migrations`: 数据库迁移文件
   - 由于使用了Sequelize，这里可能包含数据库结构的变更记录

### 10. `/models`: 数据模型
    - 定义Sequelize的数据模型，对应数据库表结构

## 主要功能实现

### 1. LLM提供商集成
   - 可能在`/src/utils`或`/src/services`中实现与不同LLM API的集成

### 2. 多助手和多主题支持
   - 在`/src/store`中管理助手和主题的状态
   - 在`/src/components`中实现相关的UI组件

### 3. 多模型对话
   - 在`/src/pages`的聊天界面中实现
   - 可能使用`/src/store`来管理对话状态

### 4. 拖放排序
   - 在`/src/components`中实现相关的可拖拽组件

### 5. 代码高亮
   - 可能使用第三方库，如Prism.js，集成在`/src/components`中

### 6. Mermaid图表支持
   - 在`/src/components`中集成Mermaid库

### 7. 数据持久化
   - 使用Sequelize在`/models`中定义数据模型
   - 在`/migrations`中管理数据库结构变更
