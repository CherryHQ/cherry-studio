---
icon: cloud-arrow-up
---

# WebDAV 备份

Cherry Studio 数据备份支持通过 WebDAV 的方式进行备份。你可以选择合适的 WebDAV 服务来进行云端备份。

基于 WebDAV 可以通过 `A电脑`  →（备份）→  `WebDAV`  →（恢复）→  `B电脑` 的方式来实现多端数据同步。

#### 以坚果云为例

1. 登录坚果云，点击右上角用户名，选择“账户信息”：

<figure><img src="../../assets/3ab21a0d07bad38773442570.png" alt=""><figcaption></figcaption></figure>

2. 选择“安全选项”，点击“添加应用”

<figure><img src="../../assets/f1f0f0b55aa3ae0222a18938.webp" alt=""><figcaption></figcaption></figure>

3. 输入应用名称，生成随机密码；

<figure><img src="../../assets/e7f0f093ff245e418805919b.webp" alt=""><figcaption></figcaption></figure>

4. 复制记录密码；

<figure><img src="../../assets/65d55f04a7052358519c733e.webp" alt=""><figcaption></figcaption></figure>

5. 获取服务器地址，账户和密码；

<figure><img src="../../assets/53bf30c1765a635f1be348ca.webp" alt=""><figcaption></figcaption></figure>

6. 在 Cherry Studio【设置】→【数据】中，填写 WebDAV 信息；

<figure><img src="../../assets/fda9297035335d99a695c2c7.webp" alt=""><figcaption></figcaption></figure>

7. 在同一页面点【备份到 WebDAV】或【从 WebDAV 恢复】，也可以设置自动备份周期与最大备份数。

{% hint style="success" %}
WebDAV 服务门槛比较低的一般就是网盘：

* [坚果云](https://www.jianguoyun.com/)
* [123 盘](https://www.123pan.com/)（需要会员）
* [阿里云盘](https://www.alipan.com/)（需要购买）
* [Box](https://www.box.com/) (免费空间容量为 10GB，单个文件大小限制为 250MB。)
* [Dropbox](https://www.dropbox.com/) （Dropbox 免费 2GB，可以邀请好友扩容 16GB 。）
* [TeraCloud](https://teracloud.jp/en/) （免费空间为 10GB，另外一个通过邀请可以获得 5GB 额外空间。）
* [Yandex Disk](https://disk.yandex.com/) (免费用户提供 10GB 容量。)

其次是一些需要自己部署服务：

* [Alist](https://alist.nn.ci/zh/)
* [Cloudreve](https://cloudreve.org/)
* [sharelist](https://github.com/reruin/sharelist)
{% endhint %}

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
