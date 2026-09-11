---
title: "Tailscale 完全指南：零基础搭建属于你自己的私有网络（保姆级教程 2026） | UU AI Hub"
description: "从安装到进阶，手把手教你用 Tailscale 搭建 WireGuard 私有网络——远程办公、NAS 访问、内网穿透一站式解决，免费支持 100 台设备"
date: 2026-09-11
category: "tailscale"
tags: ["vpn", "组网"]
source: "https://www.uuaihub.com/blog/tailscale-complete-guide"
draft: true
---

> **原文**：[Tailscale 完全指南：零基础搭建属于你自己的私有网络（保姆级教程 2026） | UU AI Hub](https://www.uuaihub.com/blog/tailscale-complete-guide) · uuaihub.com
> 抓取整理于 2026-09-11 · via crawl

## 原文

> Tailscale 是基于 WireGuard 的零配置私有网络工具，让你在任何地方都能像在同一个局域网一样访问你所有的设备——不需要公网 IP、不需要端口转发、3 分钟就能让两台设备互通。免费版支持 100 台设备，个人和小团队完全够用。
* * *

## 为什么你需要 Tailscale？
先看几个场景，感受一下它解决的是什么问题：
**场景一** ：你有一台 NAS 在家里，里面存着所有工作文件和照片。但出了家门，这些文件就完全访问不到了——除非你折腾 DDNS、端口转发、甚至冒着安全风险把 NAS 暴露到公网。
**场景二** ：你在公司电脑上开发，突然需要访问家里那台性能强劲的台式机跑个模型。远程桌面？TeamViewer 又卡又贵。SSH？根本没有公网 IP。
**场景三** ：你带着笔记本在星巴克用公共 WiFi，想安全地访问公司内网的数据库和 Git 仓库。传统 VPN 配置复杂、速度慢、IT 部门推三阻四。
**Tailscale 的答案** ：在三台设备上各装一个客户端、登录同一个账号，它们就自动组成了一个加密的私有网络。你在星巴克 `ssh ubuntu` 就能连上家里的服务器，打开 `http://nas:5000` 就能访问 NAS 管理界面——就像所有设备都插在同一个路由器上一样。
GitHub 上 **33,000+ 星标** ，全球数百万用户，Tailscale 已经是个人和小团队组网的事实标准。
* * *

## Tailscale 是怎么工作的？
理解原理有助于排错和进阶使用。Tailscale 的核心架构分为三层：

### 第一层：WireGuard 隧道
WireGuard 是 Linux 内核中的现代 VPN 协议，代码仅 4000 行（相比之下 OpenVPN 超过 7 万行），极简、极快、极安全。Tailscale 在每两台设备之间自动建立 WireGuard 端到端加密隧道。
![Tailscale 网络拓扑：WireGuard 加密隧道连接笔记本和 NAS，含 DERP 中继备用路径](/illustrations/tailscale-2026-uu-ai-hub-img1-20260911-0942.svg)

### 第二层：协调服务器
Tailscale 的云端协调服务器负责：
  * 分发密钥（每台设备有自己的 WireGuard 公私钥对）
  * 同步网络拓扑（哪些设备在线、IP 是多少）
  * 管理 ACL 规则

**关键点** ：协调服务器只传递控制信息，**不经过你的数据流量** 。数据永远走设备间的直连隧道。

### 第三层：NAT 穿透（DERP 中继）
大多数设备都在 NAT 后面（家里路由器、公司防火墙），两台 NAT 后面的设备直接通信需要 NAT 穿透。Tailscale 使用：
  * **STUN** ：尝试打洞直连，90% 的情况下能成功
  * **DERP 中继** ：打洞失败时，通过 Tailscale 的全球 DERP 服务器中继流量（端到端加密，中继服务器看不到内容）

```
设备A ──► STUN 打洞尝试 ──► 成功 → 直连（最优）
                  └──► 失败 → DERP 中继 → 设备B（稍慢，但始终加密）

```

* * *

## 安装指南（全平台）

### Windows
**方法一：微软商店（推荐）**
  1. 打开 Microsoft Store
  2. 搜索「Tailscale」
  3. 点击「安装」
  4. 安装完成后，系统托盘会出现 Tailscale 图标

**方法二：安装包**

```

# PowerShell（管理员）
winget install tailscale.tailscale

```

或者直接下载 MSI 安装包：[tailscale.com/download/windows](https://tailscale.com/download/windows)安装完成后，系统托盘右下角会出现 Tailscale 图标（小圆圈）。右键 → `Log in` 会在浏览器打开登录页面。

### macOS
**方法一：App Store（推荐）** 在 Mac App Store 搜索「Tailscale」，点击获取。
**方法二：Homebrew**

```
brew install --cask tailscale

```

安装后，菜单栏会出现 Tailscale 图标。点击 `Log in` 完成登录。
如果你偏好命令行操作（常用于无头 Mac 或远程管理）：

```

# 启动 Tailscale
sudo tailscaled --install-system-daemon

# 登录
tailscale up

```

### Linux
Tailscale 对 Linux 支持最完善。以下是各发行版的一键安装命令：
**Ubuntu / Debian：**

```
curl -fsSL https://tailscale.com/install.sh | sh

```

**CentOS / RHEL / Fedora：**

```
curl -fsSL https://tailscale.com/install.sh | sh

```

**Arch Linux：**

```
sudo pacman -S tailscale

```

**树莓派（Raspberry Pi OS）：**

```
curl -fsSL https://tailscale.com/install.sh | sh

```

安装完成后启动并登录：

```

# 启动 tailscaled 服务
sudo systemctl enable --now tailscaled

# 登录（会打印一个 URL，在浏览器中打开完成认证）
sudo tailscale up

```

**无头服务器 / 仅命令行环境** ：

```

# 使用 auth key 自动登录（适合脚本和 CI/CD）
sudo tailscale up --authkey=tskey-auth-xxxxx

# 带参数一次性完成配置
sudo tailscale up \ --accept-routes \ --advertise-exit-node \ --hostname=my-server

```

### iOS / Android
  * **iOS** ：App Store 搜索「Tailscale」
  * **Android** ：Google Play 或直接下载 APK（[tailscale.com/download/android](https://tailscale.com/download/android)）

移动端安装后打开 App，用浏览器登录即可。**iOS 特别注意** ：iOS 版 Tailscale 安装后会在系统设置中添加一个 VPN 配置文件，需要手动确认启用。

### Docker

```
docker run -d \ --name=tailscale \ -v /var/lib:/var/lib \ -v /dev/net/tun:/dev/net/tun \ --network=host \ --cap-add=NET_ADMIN \ --cap-add=NET_RAW \ tailscale/tailscale

```

Or using Docker Compose:

```
services:
  tailscale:
    image: tailscale/tailscale:latest container_name: tailscale hostname: docker-host environment:
      - TS_AUTHKEY=tskey-auth-xxxxx
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_SERVE_CONFIG=/config/serve.json
    volumes:
      - ./ts-state:/var/lib/tailscale
      - ./config:/config
    cap_add:
      - NET_ADMIN
      - NET_RAW
    network_mode: host restart: unless-stopped

```

### Synology NAS
  1. 打开「套件中心」
  2. 搜索「Tailscale」
  3. 点击安装
  4. 安装后在主菜单打开 Tailscale，点击「Log in」完成认证
  5. **重要** ：在 Tailscale 界面中勾选「允许外出连接」（outbound connections），否则其他设备无法通过 Tailscale IP 访问 NAS 上的服务

* * *

## 第一步：注册与登录
Tailscale 支持多种登录方式，选一个你已有的账号即可，无需单独注册：
| 登录方式  | 适用人群  |
| --- | --- |
| Google 账号  | 最方便，国外用户首选  |
| GitHub 账号  | 开发者推荐  |
| Microsoft 账号  | 有 Office 365 的用户  |
| Apple ID  | Mac/iOS 用户  |
| 邮箱 + 密码  | 传统方式  |
**注册流程** ：
  1. 打开 [login.tailscale.com](https://login.tailscale.com)
  2. 选择一个登录方式，完成 OAuth 授权
  3. 进入管理后台（Admin Console），你的第一台设备已经自动添加
  4. 在管理后台可以看到设备列表、IP 地址、在线状态

* * *

## 第二步：添加更多设备

### 图形界面添加
在第二台设备上安装 Tailscale 客户端 → 点击登录 → 浏览器会自动打开确认页面 → 确认后设备即加入网络。
**每个设备会自动获得一个`100.x.x.x` 的固定 IP**，例如 `100.64.0.1`、`100.72.15.33`。这个 IP 在整个 Tailscale 网络中唯一且稳定。

### 命令行添加（无头设备）

```

# 生成 auth key（在管理后台 Settings → Keys 中创建）

# 然后在新设备上执行
sudo tailscale up --authkey=tskey-auth-xxxxx

# 查看本机 Tailscale IP
tailscale ip -4

# 输出：100.76.123.45

```

### 验证连接
在任意一台设备上 ping 另一台设备的 Tailscale IP：

```

# 在笔记本上 ping NAS
ping 100.76.123.45

# 输出：

# PING 100.76.123.45 (100.76.123.45): 56 data bytes

# 64 bytes from 100.76.123.45: icmp_seq=0 ttl=64 time=5.123 ms

# 64 bytes from 100.76.123.45: icmp_seq=1 ttl=64 time=4.987 ms

```

看到回复就说明网络已通。延迟通常在个位数到几十毫秒之间（取决于物理距离和是否走了 DERP 中继）。
* * *

## 第三步：MagicDNS——用名字而不是 IP 访问设备
记 IP 太痛苦了。Tailscale 的 **MagicDNS** 功能让每台设备都有一个 `.ts.net` 域名。

### 开启 MagicDNS
  1. 打开 [Tailscale Admin Console](https://login.tailscale.com/admin/dns)
  2. 找到「MagicDNS」→ 开启
  3. 现在你的设备可以通过 `hostname.tailnet-name.ts.net` 访问了

**设置 Tailnet 名称** （在 Settings 页面），例如设为 `allen`，那么：
  * 设备名叫 `nas` → 可以用 `nas.allen.ts.net` 访问
  * 设备名叫 `laptop` → 可以用 `laptop.allen.ts.net` 访问

### 使用 MagicDNS

```

# 不用再记 IP 了
ssh allen@nas.allen.ts.net curl http://nas.allen.ts.net:5000 ping laptop.allen.ts.net

```

在浏览器里输入 `http://nas.allen.ts.net:5000` 就能打开 NAS 管理界面。就像在同一个局域网一样自然。
* * *

## 进阶功能一：子网路由——访问整个局域网
Tailscale 默认只能访问安装了 Tailscale 的设备。如果你的 NAS 接了打印机、家里的智能家居、或者公司有一整个内网需要访问，**子网路由** （Subnet Router）可以让你把整个局域网都搬到 Tailscale 网络中。

### 是什么？
把一台安装了 Tailscale 的设备（比如家里的 NAS 或树莓派）设置为**子网路由器** ，它就会把本地局域网的其他设备「广播」到 Tailscale 网络中。其他 Tailscale 设备就能直接访问这些局域网设备了。

```
┌─────────┐                              ┌──────────────┐ │ 远程笔记本 │── Tailscale 加密隧道 ──►│ NAS (子网路由) │──► 打印机 192.168.1.50 │ 100.x.x.x│                              │ 192.168.1.10 │──► 智能电视 192.168.1.20 └─────────┘                              └──────────────┘

```

### 设置子网路由
**在 NAS/树莓派（要作为路由器的设备）上：**

```

# 广播整个 192.168.1.0/24 子网
sudo tailscale up --advertise-routes=192.168.1.0/24

# 广播多个子网
sudo tailscale up --advertise-routes=192.168.1.0/24,10.0.0.0/24

```

**在 Tailscale 管理后台批准：**
  1. 打开 [Admin Console](https://login.tailscale.com/admin/machines)
  2. 找到刚才设置了子网路由的设备
  3. 点击设备右侧的「…」→「Edit route settings」
  4. 勾选要启用的子网 → 保存

现在所有 Tailscale 设备都可以直接访问 `192.168.1.x` 网段的所有设备了：

```

# 在远程笔记本上打印
ping 192.168.1.50

# 访问家里路由器管理界面
open http://192.168.1.1

```

* * *

## 进阶功能二：Exit Node——把远程设备当作 VPN 出口
有时候你不仅想访问远程网络，还想**把远程网络的互联网出口也借过来** 。
**典型场景** ：
  * 你在国内，需要访问被墙的网站 → 把一台海外 VPS 设为 Exit Node
  * 你在公共 WiFi，担心被嗅探 → 把所有流量通过家里的安全网络出口
  * 你需要用公司的 IP 访问内部系统 → 把公司一台设备设为 Exit Node

### 设置 Exit Node
**在要作为出口的设备上：**

```

# Linux 上
sudo tailscale up --advertise-exit-node

# macOS 上
sudo tailscale up --advertise-exit-node

# Windows（PowerShell 管理员）
tailscale up --advertise-exit-node

```

**在管理后台批准** ：同子网路由，找到设备 → Edit route settings → 勾选「Use as exit node」。

### 使用 Exit Node
**macOS / iOS / Windows（图形界面）** ：
  * 右键/点击 Tailscale 菜单栏图标
  * 选择「Exit Node」→ 选择你要使用的出口节点

**Linux（命令行）** ：

```

# 使用特定设备作为出口
sudo tailscale up --exit-node=100.76.123.45

# 允许局域网流量绕过 Tailscale（不影响本地打印机等）
sudo tailscale up --exit-node=100.76.123.45 --exit-node-allow-lan-access

# 停止使用 Exit Node
sudo tailscale up --exit-node=

```

现在你设备的所有互联网流量都会通过 Exit Node 出去：`curl ifconfig.me` 会显示 Exit Node 的公网 IP。
* * *

## 进阶功能三：Tailscale SSH——免密钥安全 SSH
Tailscale SSH 让你可以直接通过 Tailscale 网络 SSH 到任何设备，**不需要管理 SSH 密钥、不需要打开 22 端口、不需要配置`authorized_keys`** 。

### 开启 Tailscale SSH
**在所有要接受 SSH 连接的设备上：**

```

# Linux/macOS
sudo tailscale up --ssh

```

**在管理后台** ：Settings → Tailscale SSH → 开启

### 使用

```

# 直接用 Tailscale 设备名 SSH
ssh allen@nas

# 等价于
ssh allen@nas.allen.ts.net

# 不指定用户名：自动使用当前系统用户
ssh nas

```

Tailscale SSH 的安全性：
  * **不监听 22 端口** ：Tailscale 在自己的端口上处理 SSH，即使设备有弱密码也不会被公网扫描到
  * **自动密钥管理** ：Tailscale 自动处理密钥交换和轮换
  * **ACL 控制** ：可以在管理后台设置谁能 SSH 到哪台设备
  * **审计日志** ：所有 SSH 连接都被记录

* * *

## 进阶功能四：Tailscale Funnel——安全地暴露服务到公网
有时候你需要让**没有安装 Tailscale 的人** 访问你 Tailscale 网络中的服务。Tailscale Funnel 让你无需 Nginx 反代、无需 Cloudflare Tunnel、无需公网 IP，就能安全地将服务暴露到互联网。

### 使用 Tailscale Serve + Funnel

```

# 1. 开启 HTTPS 证书（自动通过 Let's Encrypt）
tailscale serve https:443 / http://localhost:8080

# 2. 开启 Funnel（允许公网访问）
tailscale funnel 443 on

# 3. 查看 Funnel 状态
tailscale funnel status

# 输出：

# https://nas.allen.ts.net (Funnel on)

# |-- / http://localhost:8080

```

现在任何人都可以通过 `https://nas.allen.ts.net` 访问你 NAS 上的服务了，但所有的数据仍然经过 Tailscale 的 TLS 加密。

### Funnel 限制
  * 免费版：最多 2 个 Funnel
  * 仅支持 HTTPS（自动 TLS）
  * 支持 TCP 端口 443、8443、10000

* * *

## 进阶功能五：ACL 访问控制
当你把 Tailscale 扩展到团队使用，或者有多个设备需要精确控制访问权限时，ACL（Access Control Lists）就派上用场了。

### ACL 语法（JSON）
在 [Admin Console](https://login.tailscale.com/admin/acls) 中编辑 ACL：

```
{ // 定义用户组"groups": { "group:admins": ["allen@example.com"], "group:devs": ["bob@example.com", "carol@example.com"] },

  // 定义主机属性（标签）
  "tagOwners": { "tag:prod": ["group:admins"], "tag:staging": ["group:devs"] },

  // ACL 规则"acls": [ // 管理员可以访问所有设备的所有端口{ "action": "accept", "src": ["group:admins"], "dst": ["*:*"] },

    // 开发者可以 SSH 到生产服务器{ "action": "accept", "src": ["group:devs"], "dst": ["tag:prod:22"], "users": ["dev"] },

    // 所有人可以访问 staging 的 80 和 443 { "action": "accept", "src": ["*"], "dst": ["tag:staging:80,443"] } ],

  // SSH 用户映射"ssh": [ { "action": "accept", "src": ["group:admins"], "dst": ["tag:prod"], "users": ["root"] } ] }

```

### 给设备打标签

```

# 将一台服务器标记为 production
sudo tailscale up --advertise-tags=tag:prod

# 标记后，设备的拥有者（人类用户）被移除，

# 访问权限完全由 ACL 规则控制

```

* * *

## 实际场景案例

### 案例一：远程访问 NAS + Jellyfin 影音库
**设备** ：家里的 Synology NAS + 远程笔记本/手机

```
1. 在 NAS 和所有设备上安装 Tailscale
2. NAS 上开启子网路由（需要访问 NAS 所在局域网的话）
3. 手机打开 Jellyfin App，服务器地址填 http://nas.allen.ts.net:8096
4. 在任何地方都能流畅看家里的 4K 电影

```

### 案例二：远程开发——VS Code 连接家里的 GPU 工作站

```
1. 工作站安装 Tailscale
   sudo tailscale up --ssh
2. 笔记本也安装 Tailscale
3. VS Code 安装 Remote-SSH 插件
4. SSH 配置：
   Host gpu-server HostName gpu-server.allen.ts.net User allen
5. 连接成功！在 VS Code 里用家里的 GPU 跑模型

```

### 案例三：跨境办公——借海外 VPS 访问 ChatGPT

```
1. 租一台海外 VPS（如 AWS Lightsail $3.5/月）
2. VPS 上安装 Tailscale
   sudo tailscale up --advertise-exit-node
3. 管理后台批准 Exit Node
4. 在需要时切换 Exit Node 到这台 VPS
5. 现在访问 chatgpt.com 就像在美国一样

```

### 案例四：团队协作——共享开发环境

```
1. 团队 Slack 群发 Tailscale 邀请链接
2. 每人安装客户端，加入同一个 tailnet
3. 配置 ACL：
   - 开发者可以访问 staging 环境
   - 运维可以 SSH 到生产服务器
   - 设计师只能访问设计稿服务器
4. Git 服务器用 git.allen.ts.net，内部工具用 wiki.allen.ts.net
5. 不需要 VPN 账号、不需要企业 VPN 设备、零运维成本

```

* * *

## 常见问题与排错

### Q：两个设备之间延迟很高？
**排查步骤** ：

```

# 1. 查看连接状态
tailscale status

# 输出示例：

# 100.76.1.2   nas               allen@  linux   -

# 100.76.1.3   laptop            allen@  macOS   active; direct 192.168.1.100:41641

# 100.76.1.4   phone             allen@  iOS     active; relay "sin", tx 1234 rx 5678

```

  * `direct` — 直连，最优。IP 地址表示直连路径
  * `relay "sin"` — 通过新加坡 DERP 中继。延迟会较高，但仍然是端到端加密的

**解决方案** ：
  1. 确保至少一台设备有公网 IP 或 UPnP 开启
  2. 检查防火墙是否允许 UDP 41641 端口
  3. 尝试开启 NAT-PMP/UPnP：`sudo tailscale up --accept-routes`

### Q：p2p 直连总是失败，一直在走 DERP？

```

# 强制重新协商 NAT 穿透
tailscale debug netmap

# 检查是否有对称 NAT（最难穿透）

# 两个对称 NAT 之间会稳定走 DERP

# 解决方案：给其中一台设备端口转发

```

### Q：Tailscale 占用多少资源？
  * **CPU** ：几乎为零，除非大量数据传输
  * **内存** ：约 30-50 MB
  * **带宽** ：WireGuard 本身开销约 4%（极低）
  * **空闲时** ：仅心跳包，约每分钟几 KB

### Q：免费版有什么限制？
| 功能  | Free  | Personal Pro  | Business  |
| --- | --- | --- | --- |
| 设备数  | 100  | 100  | 不限  |
| 用户数  | 3  | 6  | 不限  |
| 子网路由  | ✅  | ✅  | ✅  |
| MagicDNS  | ✅  | ✅  | ✅  |
| Funnel  | 2 个  | 10 个  | 不限  |
| ACL  | ✅  | ✅  | ✅  |
| 价格  | $0  | $4.8/月  | $18/用户/月  |
对于个人用户和 3 人以下小团队，**免费版完全够用** 。
* * *

## 同类工具对比
| 特性  | Tailscale  | ZeroTier  | NetBird  | Cloudflare Tunnel  |
| --- | --- | --- | --- | --- |
| 底层协议  | WireGuard  | 自研  | WireGuard  | Cloudflare  |
| 免费设备数  | 100  | 25  | 无限  | 无限  |
| NAT 穿透  | ⭐⭐⭐⭐⭐  | ⭐⭐⭐⭐  | ⭐⭐⭐⭐  | 不需要  |
| 易用性  | ⭐⭐⭐⭐⭐  | ⭐⭐⭐  | ⭐⭐⭐  | ⭐⭐⭐⭐  |
| 自建协调服务器  | Headscale  | 官方支持  | 完全自托管  | 不可自建  |
| GitHub Stars  | 33k  | 8k  | 11k  | 18k  |
| SSH 免密钥  | ✅  | ❌  | ❌  | ❌  |
| ACL  | ✅ JSON  | ✅  | ✅  | ✅  |
**选 Tailscale 的理由** ：如果你的痛点是「想简单快速地把几台设备连起来」，Tailscale 的易用性和开箱即用体验是最好的。如果你需要自建协调服务器（完全脱离 Tailscale 公司），可以用 Headscale（Tailscale 的开源服务端实现）。
* * *

## 总结
Tailscale 解决了一个看似简单但长期困扰所有人的问题：**让不同网络中的设备像在同一个局域网一样互相访问** 。
它的核心优势：
  * **3 分钟上手** ：装客户端 → 登录 → 搞定
  * **免费够用** ：100 台设备，个人/小团队完全免费
  * **安全可靠** ：WireGuard 端到端加密，协调服务器只看元数据不看数据
  * **功能丰富** ：MagicDNS、子网路由、Exit Node、SSH、Funnel、ACL 一应俱全
  * **全平台支持** ：Windows/macOS/Linux/iOS/Android/Docker/Synology，一个不落

如果你还有没解决的内网穿透、远程办公、NAS 访问等问题，现在就装一个 Tailscale 试试——你会在 5 分钟内惊讶于它有多好用。
* * *
_数据来源：[Tailscale 官方网站](https://tailscale.com) · [GitHub 仓库](https://github.com/tailscale/tailscale) · 33k+ Stars_ _本文基于 Tailscale 2026 年 7 月最新版本撰写_ Related