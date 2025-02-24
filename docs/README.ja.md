<h1 align="center">
  <a href="https://github.com/kangfenmao/cherry-studio/releases">
    <img src="https://github.com/kangfenmao/cherry-studio/blob/main/build/icon.png?raw=true" width="150" height="150" alt="banner" />
  </a>
</h1>
<div align="center">
  <a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | 日本語
</div>
<div align="center">
 <a href="https://trendshift.io/repositories/11772" target="_blank"><img src="https://trendshift.io/api/badge/repositories/11772" alt="kangfenmao%2Fcherry-studio | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</div>
# 🍒 Cherry Studio

Cherry Studioは、複数のLLMプロバイダーをサポートするデスクトップクライアントで、Windows、Mac、Linuxで利用可能です。

👏 [Telegram](https://t.me/CherryStudioAI)｜[Discord](https://discord.gg/wez8HtpxqQ) | [QQグループ(1025067911)](https://qm.qq.com/q/RIBAO2pPKS)

❤️ Cherry Studioをお気に入りにしましたか？小さな星をつけてください 🌟 または [スポンサー](sponsor.md) をして開発をサポートしてください！❤️

# 🌠 スクリーンショット

![](https://github.com/user-attachments/assets/28585d83-4bf0-4714-b561-8c7bf57cc600)
![](https://github.com/user-attachments/assets/8576863a-f632-4776-bc12-657eeced9da3)
![](https://github.com/user-attachments/assets/790790d7-b462-48dd-bde1-91c1697a4648)

# 🌟 主な機能

![](https://github.com/user-attachments/assets/7b4f2f78-5cbe-4be8-9aec-f98d8405a505)

1. **多様な LLM サービス対応**：

   - ☁️ 主要な LLM クラウドサービス対応：OpenAI、Gemini、Anthropic など
   - 🔗 AI Web サービス統合：Claude、Peplexity、Poe など
   - 💻 Ollama、LM Studio によるローカルモデル実行対応

2. **AI アシスタントと対話**：

   - 📚 300+ の事前設定済み AI アシスタント
   - 🤖 カスタム AI アシスタントの作成
   - 💬 複数モデルでの同時対話機能

3. **文書とデータ処理**：

   - 📄 テキスト、画像、Office、PDF など多様な形式対応
   - ☁️ WebDAV によるファイル管理とバックアップ
   - 📊 Mermaid による図表作成
   - 💻 コードハイライト機能

4. **実用的なツール統合**：

   - 🔍 グローバル検索機能
   - 📝 トピック管理システム
   - 🔤 AI による翻訳機能
   - 🎯 ドラッグ＆ドロップによる整理
   - 🔌 ミニプログラム対応

5. **優れたユーザー体験**：
   - 🖥️ Windows、Mac、Linux のクロスプラットフォーム対応
   - 📦 環境構築不要ですぐに使用可能
   - 🎨 ライト/ダークテーマと透明ウィンドウ対応
   - 📝 完全な Markdown レンダリング
   - 🤲 簡単な共有機能

# 📝 TODO

- [x] クイックポップアップ（クリップボードの読み取り、簡単な質問、説明、翻訳、要約）
- [x] 複数モデルの回答の比較
- [x] サービスプロバイダーが提供するSSOを使用したログインをサポート
- [ ] すべてのモデルがネットワークをサポート（開発中...）
- [ ] 最初の公式バージョンのリリース
- [ ] プラグイン機能（JavaScript）
- [ ] ブラウザ拡張機能（テキストをハイライトして翻訳、要約、ナレッジベースに追加）
- [ ] iOS & Android クライアント
- [ ] AIノート
- [ ] 音声入出力（AIコール）
- [ ] データバックアップはカスタムバックアップコンテンツをサポート

# 🖥️ 開発

## IDEの設定

[Cursor](https://www.cursor.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## プロジェクトの設定

### インストール

```bash
$ yarn
```

### 開発

```bash
$ yarn dev
```

### ビルド

```bash
# Windowsの場合
$ yarn build:win

# macOSの場合
$ yarn build:mac

# Linuxの場合
$ yarn build:linux
```

# 🤝 貢献

Cherry Studioへの貢献を歓迎します！以下の方法で貢献できます：

1. **コードの貢献**：新機能を開発するか、既存のコードを最適化します。
2. **バグの修正**：見つけたバグを修正します。
3. **問題の管理**：GitHubの問題を管理するのを手伝います。
4. **製品デザイン**：デザインの議論に参加します。
5. **ドキュメントの作成**：ユーザーマニュアルやガイドを改善します。
6. **コミュニティの参加**：ディスカッションに参加し、ユーザーを支援します。
7. **使用の促進**：Cherry Studioを広めます。

## 始め方

1. **リポジトリをフォーク**：フォークしてローカルマシンにクローンします。
2. **ブランチを作成**：変更のためのブランチを作成します。
3. **変更を提出**：変更をコミットしてプッシュします。
4. **プルリクエストを開く**：変更内容と理由を説明します。

詳細なガイドラインについては、[貢献ガイド](./CONTRIBUTING.md)をご覧ください。

ご支援と貢献に感謝します！

## 関連頁版

- [one-api](https://github.com/songquanpeng/one-api):LLM APIの管理・配信システム。OpenAI、Azure、Anthropicなどの主要モデルに対応し、統一APIインターフェースを提供。APIキー管理と再配布に利用可能。

# 🚀 コントリビューター

<a href="https://github.com/kangfenmao/cherry-studio/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=kangfenmao/cherry-studio" />
</a>

# コミュニティ

[Telegram](https://t.me/CherryStudioAI) | [Email](mailto:kangfenmao@gmail.com) | [Twitter](https://x.com/kangfenmao)

# 📣 プロダクトハント

<a href="https://www.producthunt.com/posts/cherry-studio?embed=true&utm_source=badge-featured&utm_medium=badge&utm_souce=badge-cherry&#0045;studio" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=496640&theme=light" alt="Cherry&#0032;Studio - AI&#0032;Chatbots&#0044;&#0032;AI&#0032;Desktop&#0032;Client | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>

# スポンサー

[Buy Me a Coffee](sponsor.md)

# 📃 ライセンス

[LICENSE](../LICENSE)

# ⭐️ スター履歴

[![Star History Chart](https://api.star-history.com/svg?repos=kangfenmao/cherry-studio&type=Timeline)](https://star-history.com/#kangfenmao/cherry-studio&Timeline)
