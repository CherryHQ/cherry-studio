#!/bin/bash
# 首先直接构建，跳过TypeScript检查
electron-vite build

# 然后使用electron-builder构建Windows版本
electron-builder --win
