# Cherry Studio 图标使用指南

## 新增的图标

我们为Cherry Studio添加了以下新图标：

1. Google Drive 图标 - 用于Google Drive备份设置
   - 使用简洁的三角形设计，符合Google Drive的品牌特征
   - 保持单色风格，与应用整体设计语言一致

2. OneDrive 图标 - 用于OneDrive备份设置
   - 使用简化的云形状设计，符合OneDrive的品牌特征
   - 同样采用单色风格，确保与其他图标视觉统一

这些图标经过精心设计，完全符合Cherry Studio的设计语言，能够无缝融入到现有界面中。

## 如何生成图标字体

要将SVG图标转换为字体文件并更新应用程序，请按照以下步骤操作：

### 安装依赖

```bash
npm install --save-dev webfonts-generator
```

### 运行生成脚本

```bash
npm run generate:iconfont
```

或者直接运行：

```bash
node scripts/generate-iconfont.js
```

这将使用`src/renderer/src/assets/icons`目录中的SVG文件生成新的字体文件，并将其放置在`src/renderer/src/assets/fonts/icon-fonts`目录中。

### 集成到应用程序

生成后的字体文件会自动被应用程序使用，因为我们已经在样式表中引用了它们：

```typescript
// Google Drive图标组件
import * as React from 'react'

const GoogleDriveIcon: React.FC = () => {
  return <i className="iconfont icon-googledrive" />
}

export default GoogleDriveIcon
```

## 添加新图标

如果您想添加新图标，请遵循以下步骤：

1. 在`src/renderer/src/assets/icons`目录中添加新的SVG文件。
2. 文件名应该是图标名称，例如`newicon.svg`。
3. 在iconfont.css中添加相应的CSS类，例如`.icon-newicon:before { content: '\eXXX'; }`，其中XXX是一个唯一的十六进制代码。
4. 运行生成脚本以更新字体文件。
5. 创建一个新的图标组件或在应用程序中直接使用`<i className="iconfont icon-newicon" />`。

## 设计指南

创建新图标时，请遵循以下设计指南：

1. 使用简单的线条和形状。
2. 保持图标单色，以便可以通过CSS修改颜色。
3. 确保图标设计与现有图标一致。
4. 图标应该是24x24像素大小，带有清晰的2像素线条。 