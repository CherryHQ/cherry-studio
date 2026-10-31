---
icon: cloud-binary
---

# S3 兼容存储备份

Cherry Studio 数据备份支持通过 S3 兼容存储(对象存储)的方式进行备份。常见的 S3 兼容存储服务有：AWS S3、Cloudflare R2、阿里云 OSS、腾讯云 COS 以及 MinIO 等。

基于 S3 兼容存储可以通过 `A电脑`  →（备份）→  `S3存储`  →（恢复）→  `B电脑` 的方式来实现多端数据同步。

### 配置 S3 兼容存储

1. 创建对象存储桶（Bucket），并记录下存储桶名称。**强烈建议将存储桶设置为私有读写以避免备份数据泄露！！**
2. 参考文档，前往云服务控制台获取 S3 兼容存储的 `Access Key ID`、`Secret Access Key`、`Endpoint`、`Bucket`、`Region` 等信息。
   - **Endpoint**：S3 兼容存储的访问地址，通常形如 `https://<bucket-name>.<region>.amazonaws.com` 或 `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`。
   - **Region**：存储桶所在的区域，例如 `us-west-1`、`ap-southeast-1` 等，cloudflare R2 请填写 `auto`。
   - **Bucket**：存储桶名称。
   - **Access Key ID** 和 **Secret Access Key**：用于身份验证的凭据。
   - **Root Path**：可选，指定备份到存储桶时的根路径，默认为空。
   - **相关文档**
     - AWS S3：[获取 Access Key ID 和 Secret Access Key](https://docs.aws.amazon.com/zh_cn/IAM/latest/UserGuide/id_credentials_access-keys.html)
     - Cloudflare R2：[获取 Access Key ID 和 Secret Access Key](https://developers.cloudflare.com/r2/api/tokens/)
     - 阿里云 OSS：[获取 Access Key ID 和 Access Key Secret](https://help.aliyun.com/zh/oss/developer-reference/use-amazon-s3-sdks-to-access-oss#306596478ed3r)
     - 腾讯云 COS：[获取 SecretId 和 SecretKey](https://cloud.tencent.com/document/product/436/37421)
3. 在 S3 备份设置中填写上述信息，点击备份按钮即可进行备份，点击管理按钮可以查看和管理备份文件列表。

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
