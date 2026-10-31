---
icon: searchengin
---

# SearXNG 本地部署与配置

CherryStudio 支持通过 SearXNG 进行网络搜索，SearXNG 是一个可本地部署也可在服务器上部署的开源项目，所以与其他需要 API 提供商的配置方式略有不同。

**SearXNG 项目链接**：[SearXNG](https://github.com/searxng/searxng)

## SearXNG 的优势

* 开源免费，无需 API
* 隐私性相对较高
* 可高度定制化

## 本地部署

### 一、Docker 直接部署

由于 SearXNG 不需要复杂的环境配置，可以不用 docker compose，只需要简单提供一个空闲端口即可部署，所以最快捷的方式可以使用 Docker 直接拉取镜像进行部署。

#### 1. 下载安装并配置 [docker](https://www.docker.com/)

<figure><img src="../../assets/36a2223ad6a74755f9438450.webp" alt=""><figcaption></figcaption></figure>

安装后选择一个镜像存储路径：

<figure><img src="../../assets/f7572e7242786dec7c27bb91.png" alt=""><figcaption></figcaption></figure>

#### 2. 搜索并拉取 SearXNG 镜像

搜索栏输入 **searxng** ：

<figure><img src="../../assets/b52b7668925a50513c3ab7a2.webp" alt=""><figcaption></figcaption></figure>

拉取镜像：

<figure><img src="../../assets/5dafa0076ead5eeb692be20b.webp" alt=""><figcaption></figcaption></figure>

<figure><img src="../../assets/b1fe9a5844d2d6f7bc0a838a.png" alt=""><figcaption></figcaption></figure>

#### 3. 运行镜像

拉取成功后来到 **images** 页面：

<figure><img src="../../assets/7c1012848c3c6094596c91a1.png" alt=""><figcaption></figcaption></figure>

选择拉取的镜像点击运行：

<figure><img src="../../assets/221bbed549ef2ac3b0a864bf.webp" alt=""><figcaption></figcaption></figure>

打开设置项进行配置：

<figure><img src="../../assets/0d16c62b496005cda1bffce3.png" alt=""><figcaption></figcaption></figure>

以 `8085` 端口为例：

<figure><img src="../../assets/9886d746078c3285007a8da6.png" alt=""><figcaption></figcaption></figure>

运行成功后点击链接即可打开 SearXNG 的前端界面：

<figure><img src="../../assets/4a60cdbf629c607c929177a0.png" alt=""><figcaption></figcaption></figure>

出现这个页面说明部署成功：

<figure><img src="../../assets/70293f8a218c352fd7d84ad5.webp" alt=""><figcaption></figcaption></figure>

## 服务器部署

鉴于 Windows 下安装 Docker 是一件较为麻烦的事情，用户可以将 SearXNG 部署在服务器上，也可借此共享给其他人使用。但是很遗憾，SearXNG 自身暂不支持鉴权，导致他人可以通过技术手段扫描到并滥用你部署的实例。

为此，Cherry Studio 目前已支持配置 [HTTP 基本认证（RFC7617）](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Authentication)，如果用户欲将自己部署的 SearXNG 暴露在公网环境下，请 **务必** 通过 Nginx 等反向代理软件配置 HTTP 基本认证。下面提供简要教程，需要你有基本的 Linux 运维知识。

### 部署 SearXNG

类似地，仍然使用 Docker 部署。假设你已经按照 [官方教程](https://docs.docker.com/engine/install) 在服务器上安装好了最新版 Docker CE，以下提供一条龙命令，适用于 Debian 系统下全新安装：

```bash
sudo apt update
sudo apt install git -y

# 拉取官方仓库
cd /opt
git clone https://github.com/searxng/searxng-docker.git
cd /opt/searxng-docker

# 如果你的服务器带宽很小, 可以设置为 false
export IMAGE_PROXY=true

# 修改配置文件
cat <<EOF > /opt/searxng-docker/searxng/settings.yml
# see https://docs.searxng.org/admin/settings/settings.html#settings-use-default-settings
use_default_settings: true
server:
  # base_url is defined in the SEARXNG_BASE_URL environment variable, see .env and docker-compose.yml
  secret_key: $(openssl rand -hex 32)
  limiter: false # can be disabled for a private instance
  image_proxy: $IMAGE_PROXY
ui:
  static_use_hash: true
redis:
  url: redis://redis:6379/0
search:
  formats:
    - html
    - json
EOF
```

如果你需要修改本地监听端口、复用本地已有的 nginx，可以编辑 `docker-compose.yaml` 文件，参考如下：

```yaml
version: "3.7"

services:
# 如果不需要 Caddy 而复用本地已经有的 Nginx, 就把下面的去掉. 我们默认不需要 Caddy.
  caddy:
    container_name: caddy
    image: docker.io/library/caddy:2-alpine
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data:rw
      - caddy-config:/config:rw
    environment:
      - SEARXNG_HOSTNAME=${SEARXNG_HOSTNAME:-http://localhost}
      - SEARXNG_TLS=${LETSENCRYPT_EMAIL:-internal}
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    logging:
      driver: "json-file"
      options:
        max-size: "1m"
        max-file: "1"
# 如果不需要 Caddy 而复用本地已经有的 Nginx, 就把上面的去掉. 我们默认不需要 Caddy.
  redis:
    container_name: redis
    image: docker.io/valkey/valkey:8-alpine
    command: valkey-server --save 30 1 --loglevel warning
    restart: unless-stopped
    networks:
      - searxng
    volumes:
      - valkey-data2:/data
    cap_drop:
      - ALL
    cap_add:
      - SETGID
      - SETUID
      - DAC_OVERRIDE
    logging:
      driver: "json-file"
      options:
        max-size: "1m"
        max-file: "1"

  searxng:
    container_name: searxng
    image: docker.io/searxng/searxng:latest
    restart: unless-stopped
    networks:
      - searxng
    # 默认映射到宿主机 8080 端口, 假如你想监听 8000 就改成 "127.0.0.1:8000:8080"
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - ./searxng:/etc/searxng:rw
    environment:
      - SEARXNG_BASE_URL=https://${SEARXNG_HOSTNAME:-localhost}/
      - UWSGI_WORKERS=${SEARXNG_UWSGI_WORKERS:-4}
      - UWSGI_THREADS=${SEARXNG_UWSGI_THREADS:-4}
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETGID
      - SETUID
    logging:
      driver: "json-file"
      options:
        max-size: "1m"
        max-file: "1"

networks:
  searxng:

volumes:
# 如果不需要 Caddy 而复用本地已经有的 Nginx, 就把下面的去掉
  caddy-data:
  caddy-config:
# 如果不需要 Caddy 而复用本地已经有的 Nginx, 就把上面的去掉
  valkey-data2:
```

执行 `docker compose up -d` 启动。执行 `docker compose logs -f searxng` 可以看到日志。

### 部署 Nginx 反向代理和 HTTP 基本认证

如果你使用了一些服务器面板程序，例如宝塔面板或 1Panel，请参阅其文档添加网站并配置 nginx 反向代理，随后找到修改 nginx 配置文件的地方，\
参考下面的示例进行修改：

```conf
server
{
    listen 443 ssl;

    # 这行是你的主机名
    server_name search.example.com;

    # index index.html;
    # root /data/www/default;

    # 如果配置了 SSL 应该有这两行
    ssl_certificate /path/to/your/cert/fullchain.pem;
    ssl_certificate_key /path/to/your/cert/privkey.pem;

    # HSTS
    # add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload";

    # 默认情况下通过面板配置反向代理, 默认的 location 块就是这样
    location / {
        # 只需要在 location 块添加下面两行, 其他保留原状就行.
        # 此处示例假设你的配置文件保存在 /etc/nginx/conf.d/ 目录下.
        # 如果是宝塔应该是保存在 /www 之类的目录下, 需要注意.
        auth_basic "Please enter your username and password";
        auth_basic_user_file /etc/nginx/conf.d/search.htpasswd;

        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_redirect off;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_protocol_addr;
        proxy_pass http://127.0.0.1:8000;
        client_max_body_size 0;
    }

    # access_log ...;
    # error_log ...;
}
```

假设 Nginx 配置文件保存于 `/etc/nginx/conf.d` 下，我们将将密码文件保存在同目录下。

执行命令（自行将 `example_name`、`example_password` 替换为你将要设定的用户名和密码）：

```bash
echo "example_name:$(openssl passwd -5 'example_password')" > /etc/nginx/conf.d/search.htpasswd
```

重启 Nginx（重载配置也可以）。

这时可以打开一下网页，已经会提示你输入用户名和密码，请输入前面设定的用户名和密码查看能否成功进入 SearXNG 搜索页面，藉此检查配置是否正确。

<figure><img src="../../assets/a98dfc8aa250c49f1823c605.webp" alt=""><figcaption></figcaption></figure>

## Cherry Studio 相关配置

SearXNG 本地或在服务器部署成功后，接下来是 CherryStudio 的相关配置。

来到网络搜索设置页面，选择 Searxng ：

<figure><img src="../../assets/1a20b796ac7076049b95f91c.webp" alt=""><figcaption></figcaption></figure>

直接输入本地部署的链接发现验证失败，此时不用担心：

<figure><img src="../../assets/84394efb52fd620e87b4be56.webp" alt=""><figcaption></figcaption></figure>

因为直接部署后默认并没有配置 json 返回类型，所以无法获取数据，需要修改配置文件。

回到 Docker，来到 Files 标签页找到镜像中找到带标签的文件夹：

<figure><img src="../../assets/c60179784ede7bfc8e494149.png" alt=""><figcaption></figcaption></figure>

展开后继续往下翻，会发现另一个带标签的文件夹：

<figure><img src="../../assets/1f1f1979eff7079b81e44712.webp" alt=""><figcaption></figcaption></figure>

继续展开，找到 **settings.yml** 配置文件：

<figure><img src="../../assets/b5404fe79eedd68313f52e50.webp" alt=""><figcaption></figcaption></figure>

点击打开文件编辑器：

<figure><img src="../../assets/256b0f0b130cd6a0675dbf68.webp" alt=""><figcaption></figcaption></figure>

找到 78 行，可以看到类型只有一个 html

<figure><img src="../../assets/73dae19728e0277674c00972.webp" alt=""><figcaption></figcaption></figure>

添加 json 类型后保存，重新运行镜像

<figure><img src="../../assets/502cd1dfbd21b235e6ad930e.webp" alt=""><figcaption></figcaption></figure>

<figure><img src="../../assets/6a338a946c3d09f4c0a85280.webp" alt=""><figcaption></figcaption></figure>

重新回到 Cherry Studio 进行验证，验证成功：

<figure><img src="../../assets/09ba5a8e53909465e8b82a3a.webp" alt=""><figcaption></figcaption></figure>

地址既可以填写本地： [http://localhost](http://localhost) : 端口号\
也可以填写 docker 地址：[http://host.docker.internal](http://host.docker.internal) : 端口号

如果用户遵循前面的示例在服务器上部署并正确配置了反向代理，已经开启了 json 返回类型。输入地址后进行验证，由于已给反向代理配置了 HTTP 基本认证，此时验证则应返回 401 错误码：

<figure><img src="../../assets/4b6f5b6d14fa1575fac7dcf9.webp" alt=""><figcaption></figcaption></figure>

在客户端配置 HTTP 基本认证，输入刚才设置的用户名与密码：

<figure><img src="../../assets/6935b6c638cd2edda1adf128.webp" alt=""><figcaption></figcaption></figure>

进行验证，应当验证成功。

### 其他配置

此时 SearXNG 已具备默认联网搜索能力，如需定制搜索引擎需要自行进行配置

需要注意的是此处首选项并不能影响大模型调用时的配置

<figure><img src="../../assets/2f90523a92a6e8faee642306.webp" alt=""><figcaption></figcaption></figure>

如需配置需要大模型调用的搜索引擎，需在配置文件中设置：

<figure><img src="../../assets/bac57409b07fe4274bb7b557.webp" alt=""><figcaption></figcaption></figure>

<figure><img src="../../assets/7af6ac822e82923466bd47ad.webp" alt=""><figcaption></figcaption></figure>

配置语言参考：

<figure><img src="../../assets/00af4cfe633cb13aaab9064b.webp" alt=""><figcaption></figcaption></figure>

若内容太长直接修改不方便，可将其复制到本地 IDE 中，修改后粘贴到配置文件中即可。

## 验证失败常见原因

### 返回格式未添加 json 格式

在配置文件中将返回格式加上 json：

<figure><img src="../../assets/e1254790f7d2b06d59aac1fc.webp" alt=""><figcaption></figcaption></figure>

### 未正确配置搜索引擎

Cherry Studio 会默认选取 categories 同时包含 web general 的引擎进行搜索，默认情况下会选中 google 等引擎，由于大陆无法直接访问 google 等网站导致失败。增加以下配置使得 searxng 强制使用 baidu 引擎，即可解决问题：

```
use_default_settings:
  engines:
    keep_only:
      - baidu
engines:
  - name: baidu
    engine: baidu 
    categories: 
      - web
      - general
    disabled: false
```

### 访问速率过快

searxng 的 limiter 配置阻碍了 API 访问，请尝试将其在设置中设为 false：

<figure><img src="../../assets/73d1cfd3257ee30da6d76d01.webp" alt=""><figcaption></figcaption></figure>

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
