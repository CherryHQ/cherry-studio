// // 可能会废弃，在流上做delay还是有问题

// import { definePlugin, smoothStream } from '@cherrystudio/ai-core'

// export default definePlugin({
//   name: 'textPlugin',
//   transformStream: () =>
//     smoothStream({
//       delayInMs: 50,
//       // 中文3个字符一个chunk,英文一个单词一个chunk
//       chunking: /([\u4E00-\u9FFF]{3})|\S+\s+/
//     })
// })
