#!/bin/bash

# 请替换为您的GitHub个人访问令牌
# 如需创建新令牌，请访问: https://github.com/settings/tokens
# 需要有repo权限
GITHUB_TOKEN="你的github token"
REPO="SiinXu/cherry-studio"
TAG="safe-array-utils"
NAME="Cherry Studio - 安全数组工具增强版"
BODY=$(cat RELEASE_NOTES.md)

# 创建release
response=$(curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$REPO/releases" \
  -d "{
    \"tag_name\": \"$TAG\",
    \"name\": \"$NAME\",
    \"body\": \"$BODY\",
    \"draft\": false,
    \"prerelease\": false
  }"
)

# 获取release ID
release_id=$(echo $response | grep -o '"id": [0-9]*' | head -1 | sed 's/"id": //')
echo "Created release with ID: $release_id"

# 上传资产
upload_asset() {
  local file=$1
  local name=$(basename "$file")
  
  echo "Uploading $name..."
  curl -s \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary @"$file" \
    "https://uploads.github.com/repos/$REPO/releases/$release_id/assets?name=$name"
  
  echo -e "\nUploaded $name"
}

# 上传所有DMG和ZIP文件
upload_asset "Releases/Cherry Studio-1.0.1-x64.dmg"
upload_asset "Releases/Cherry Studio-1.0.1-arm64.dmg"
upload_asset "Releases/Cherry Studio-1.0.1-x64.zip"
upload_asset "Releases/Cherry Studio-1.0.1-arm64.zip"

echo "Release created and assets uploaded successfully!"
