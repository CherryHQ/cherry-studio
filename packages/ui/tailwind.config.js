// Tailwind config for UI component library
// This config is used for development and provides a template for consumers

let heroui
try {
  // Try to load heroui if available (dev environment)
  heroui = require('@heroui/react').heroui
} catch (e) {
  // Fallback for environments without heroui
  heroui = () => ({})
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    // 扫描当前包的所有组件文件
    './src/**/*.{js,ts,jsx,tsx}',
    // 扫描 HeroUI 的组件样式（如果存在）
    './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      // 基础组件库主题扩展
    }
  },
  darkMode: 'class',
  plugins: [heroui()]
}
