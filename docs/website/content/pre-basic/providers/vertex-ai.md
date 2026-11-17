---
description: 暂时不支持Claude模型
---

# Vertex AI

## 教程概述

### 1. 获取 API Key

* 获取 Gemini 的 API Key 前，你需要有一个 Google Cloud 项目（如果你已有，此过程可跳过）
* 进入 [Google Cloud](https://console.cloud.google.com/projectcreate) 创建项目，填写项目名称并点击创建项目

<figure><img src="../../assets/8f9c0115bb319f382af9a285.webp" alt=""><figcaption></figcaption></figure>

* 进入 [Vertex AI 控制台](https://console.cloud.google.com/vertex-ai)
* 在创建的项目中开通 [Vertex AI API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com?inv=1\&invt=Ab0iBA)

<figure><img src="../../assets/96e82ac0955b37a74db6b69a.webp" alt=""><figcaption></figcaption></figure>

## 2. 设置 API 访问权限

* 打开 [服务账号](https://console.cloud.google.com/iam-admin/serviceaccounts) 权限界面，创建服务账号

<figure><img src="../../assets/30f5231c6907a019ae7b9250.webp" alt=""><figcaption></figcaption></figure>

* 在服务账号管理页面找到刚刚创建的服务账号，点击 `密钥` 并创建一个新的 JSON 格式密钥

<figure><img src="../../assets/d320ae7c346ac2b623a4a8ef.webp" alt=""><figcaption></figcaption></figure>

* 创建成功后，密钥文件将会以 JSON 文件的格式自动保存到你的电脑上，请 **妥善保存**

## 3. 在 Cherry Studio 中配置 Vertex AI

* 选择 Vertex AI 服务商
* 将 JSON 文件的对应字段填入

<figure><img src="../../assets/7e6fa74e4cec7ed09526cc60.webp" alt=""><figcaption></figcaption></figure>

点击添加 [模型](https://console.cloud.google.com/vertex-ai/model-garden)，就可以愉快地开始使用了！

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
