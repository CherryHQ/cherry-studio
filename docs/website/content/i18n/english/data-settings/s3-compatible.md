---
icon: cloud-binary
---
# S3 Compatible Storage Backup

Cherry Studio data backup supports backing up data via S3 compatible storage (object storage). Common S3 compatible storage services include: AWS S3, Cloudflare R2, Alibaba Cloud OSS, Tencent Cloud COS, and MinIO, among others.

Multi-terminal data synchronization can be achieved based on S3 compatible storage in the following way: `A PC`  → (Backup) →  `S3 Storage`  → (Restore) →  `B PC`.

### Configure S3 Compatible Storage

1.  Create an object storage bucket and record its name. **It is strongly recommended to set the bucket to private read/write to prevent backup data leakage!!**
2.  Refer to the documentation and go to the cloud service console to obtain the `Access Key ID`, `Secret Access Key`, `Endpoint`, `Bucket`, `Region`, and other information for your S3 compatible storage.
    *   **Endpoint**: The access address for S3 compatible storage, typically in the form of `https://<bucket-name>.<region>.amazonaws.com` or `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
    *   **Region**: The region where the bucket is located, such as `us-west-1`, `ap-southeast-1`, etc. For Cloudflare R2, please enter `auto`.
    *   **Bucket**: The name of the bucket.
    *   **Access Key ID** and **Secret Access Key**: Credentials used for authentication.
    *   **Root Path**: Optional, specifies the root path when backing up to the bucket, defaults to empty.
    *   **Related Documentation**
        *   AWS S3: [Get Access Key ID and Secret Access Key](https://docs.aws.amazon.com/zh_cn/IAM/latest/UserGuide/id_credentials_access-keys.html)
        *   Cloudflare R2: [Get Access Key ID and Secret Access Key](https://developers.cloudflare.com/r2/api/tokens/)
        *   Alibaba Cloud OSS: [Get Access Key ID and Access Key Secret](https://www.alibabacloud.com/help/en/oss/developer-reference/use-amazon-s3-sdks-to-access-oss)
        *   Tencent Cloud COS: [Get SecretId and SecretKey](https://cloud.tencent.com/document/product/436/37421)
3.  Fill in the above information in the S3 backup settings, click the backup button to perform a backup, and click the manage button to view and manage the list of backup files.