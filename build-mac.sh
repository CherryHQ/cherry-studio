#!/bin/bash
# 跳过TypeScript检查，直接构建
NODE_ENV=production npx electron-vite build

# 然后使用electron-builder构建Mac版本，使用多个参数跳过原生模块编译问题
ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES=true NODE_GYP_FORCE_PYTHON=python3 ELECTRON_BUILDER_SKIP_REBUILD=true NPM_CONFIG_IGNORE_SCRIPTS=true npx electron-builder --mac -c.mac.identity=null -c.npmRebuild=false

# 如果electron-builder的DMG创建失败，创建一个标准的DMG包
if [ ! -f "./dist/Cherry Studio-*.dmg" ]; then
  echo "Creating standard DMG package..."
  # 创建临时文件夹
  mkdir -p /tmp/dmg-build
  # 复制应用程序
  cp -r ./dist/mac/Cherry\ Studio.app /tmp/dmg-build/
  # 创建Applications文件夹快捷方式
  ln -s /Applications /tmp/dmg-build/Applications
  # 创建DMG
  hdiutil create -volname "Cherry Studio" -srcfolder /tmp/dmg-build -ov -format UDZO -fs HFS+ ./dist/DMG/Cherry-Studio-Standard.dmg
  echo "DMG created at ./dist/DMG/Cherry-Studio-Standard.dmg"
fi
