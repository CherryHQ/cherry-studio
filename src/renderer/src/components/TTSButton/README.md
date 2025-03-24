# TTS按钮组件

`TTSButton` 是一个用于提供文本朗读功能的通用组件，可以集成到应用程序的任何部分，为用户提供便捷的文本朗读功能。

## 组件特性

- 提供简洁的朗读按钮UI
- 自动检测TTS服务是否可用
- 支持朗读状态显示（播放中/停止）
- 当TTS功能未启用时自动隐藏
- 包含错误处理和用户反馈

## 使用方法

```tsx
import TTSButton from '@renderer/components/TTSButton';

// 在消息组件中使用
const MessageItem = ({ message }) => {
  return (
    <div className="message-container">
      <div className="message-content">{message.content}</div>
      <div className="message-actions">
        <TTSButton text={message.content} size="small" />
        {/* 其他操作按钮 */}
      </div>
    </div>
  );
};

// 在文章组件中使用
const ArticleView = ({ article }) => {
  return (
    <div className="article-container">
      <div className="article-header">
        <h1>{article.title}</h1>
        <TTSButton 
          text={article.content} 
          tooltip="朗读全文" 
          style={{ marginLeft: 8 }} 
        />
      </div>
      <div className="article-content">{article.content}</div>
    </div>
  );
};
```

## 参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| text | string | (必填) | 要朗读的文本内容 |
| size | 'small' \| 'middle' \| 'large' | 'middle' | 按钮尺寸 |
| style | CSSProperties | undefined | 按钮自定义样式 |
| tooltip | string | '朗读文本' | 鼠标悬停提示文本 |

## 集成建议

### 适合添加TTSButton的位置：

1. 聊天消息界面 - 在每条消息旁添加朗读按钮
2. 长文本内容 - 在文章、文档或文本块顶部添加朗读按钮
3. 教育内容 - 在学习材料中添加朗读功能
4. 辅助功能区 - 为视障用户提供文本朗读支持

### 实现建议：

1. 在消息卡片组件中集成 (MessageCard.tsx)
2. 在文档查看器中集成 (DocumentViewer.tsx)
3. 在设置页面中提供测试功能 (TTSSettings.tsx) - 已实现

## 注意事项

- 组件会检查 ttsEnabled 设置，只有在启用TTS功能时才会显示
- 对于非常长的文本，建议考虑分段朗读或添加进度指示
- 确保在设置中已正确配置TTS服务，否则会提示错误
