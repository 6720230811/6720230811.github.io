---
title: "Git 指令看这一篇就够 —— 各种工作场景的 git 指令大全 - jamiechoo - 博客园"
description: "本文总结了日常工作中常用的 git 指令，涵盖了绝大部分的使用场景，让你能够轻松应对各种 git 协作流程。 理解 git 工作区域 根据 git 的几个文件存储区域，git 的工作区域可以划分为 4 个： 工作区：你在本地编辑器里改动的代码，所见即所得，里面的内容都是最新的 暂存区：通过 git"
date: 2026-09-11
category: "技术"
tags: ["git"]
source: "https://www.cnblogs.com/jamiechoo/articles/18408791"
---

> **原文**：[Git 指令看这一篇就够 —— 各种工作场景的 git 指令大全 - jamiechoo - 博客园](https://www.cnblogs.com/jamiechoo/articles/18408791) · cnblogs.com
> 抓取整理于 2026-09-11 · via crawl

## 原文

本文总结了日常工作中常用的 git 指令，涵盖了绝大部分的使用场景，让你能够轻松应对各种 git 协作流程。

## 理解 git 工作区域
根据 git 的几个文件存储区域，git 的工作区域可以划分为 4 个：
  * 工作区：你在本地编辑器里改动的代码，所见即所得，里面的内容都是最新的
  * 暂存区：通过 `git add` 指令，会将你工作区改动的代码提交到暂存区里
  * 本地仓库：通过 `git commit` 指令，会将暂存区变动的代码提交到本地仓库中，本地仓库位于你的电脑上
  * 远程仓库：远端用来托管代码的仓库，通过 `git push` 指令，会将本地仓库的代码推送到远程仓库中

![](https://img2024.cnblogs.com/blog/1928016/202409/1928016-20240911185334490-1889863844.png)

## 初始配置

### 配置用户信息
首次使用 git 时，设置提交代码时的信息：

```

# 配置用户名
git config --global user.name "yourname"

# 配置用户邮箱
git config --global user.email "youremail@xxx.com"

# 查看当前的配置信息
git config --global --list

# 通过 alias 配置简写

## 例如使用 git co 代替 git checkout
git config --global alias.co checkout

```

### ssh key
向远端仓库提交代码时，需要在远端仓库添加本地生成的 ssh key。
  1. 生成本地 ssh key，若已有直接到第 2 步:

```
ssh-keygen -t rsa -C "youremail@xxx.com"

```

  2. 查看本地 ssh key:

```
cat ~/.ssh/id_rsa.pub

```

  3. 将 ssh key 粘贴到远端仓库：

## 高频命令
以下是最常用的操作，需要任何一个开发者学会的 git 命令：

### git clone: 克隆仓库

```

# 克隆远端仓库到本地
git clone <git url>

# 克隆远端仓库到本地，并同时切换到指定分支 branch1
git clone <git url> -b branch1

# 克隆远端仓库到本地并指定本地仓库的文件夹名称为 my-project
git clone <git url> my-project

```

### git add: 提交到暂存区
工作区提交到暂存区，用到的指令为 `git add`：

```

# 将所有修改的文件都提交到暂存区
git add .

# 将修改的文件中的指定的文件 a.js 和 b.js 提交到暂存区
git add ./a.js ./b.js

# 将 js 文件夹下修改的内容提交到暂存区
git add ./js

```

### git commit: 提交到本地仓库
将工作区内容提交到本地仓库所用到的指令为 `git commit`：

```

# 将工作区内容提交到本地仓库，并添加提交信息 your commit message
git commit -m "your commit message"

# 将工作区内容提交到本地仓库，并对上一次 commit 记录进行覆盖

## 例如先执行 git commit -m "commit1" 提交了文件a，commit_sha为hash1；再执行 git commit -m "commit2" --amend 提交文件b，commit_sha为hash2。最终显示的是a，b文件的 commit 信息都是 "commit2"，commit_sha都是hash2
git commit -m "new message" --amend

# 将工作区内容提交到本地仓库，并跳过 commit 信息填写

## 例如先执行 git commit -m "commit1" 提交了文件a，commit_sha为hash1；再执行 git commit --amend --no-edit 提交文件b，commit_sha为hash2。最终显示的是a，b文件的 commit 信息都是 "commit1"，commit_sha都是hash1
git commit --amend --no-edit

# 跳过校验直接提交，很多项目配置 git hooks 验证代码是否符合 eslint、husky 等规则，校验不通过无法提交

## 通过 --no-verify 可以跳过校验（为了保证代码质量不建议此操作QwQ）
git commit --no-verify -m "commit message"

# 一次性从工作区提交到本地仓库，相当于 git add . + git commit -m
git commit -am

```

### git push: 提交到远程仓库
`git push` 会将本地仓库的内容推送到远程仓库

```

# 将当前本地分支 branch1 内容推送到远程分支 origin/branch1
git push

# 若当前本地分支 branch1，没有对应的远程分支 origin/branch1，需要为推送当前分支并建立与远程上游的跟踪
git push --set-upstream origin branch1

# 强制提交

## 例如用在代码回滚后内容
git push -f

```

### git pull: 拉取远程仓库并合并
`git pull` 会拉取远程仓库并合并到本地仓库，相当于执行 `git fetch` + `git merge`

```

# 若拉取并合并的远程分支和当前本地分支名称一致

## 例如当前本地分支为 branch1，要拉取并合并 origin/branch1，则直接执行：
git pull

# 若拉取并合并的远程分支和当前本地分支名称不一致
git pull <远程主机名> <分支名>

## 例如当前本地分支为 branch2，要拉取并合并 origin/branch1，则执行：
git pull git@github.com:zh-lx/git-practice.git branch1

# 使用 rebase 模式进行合并
git pull --rebase

```

### git checkout: 切换分支
`git checkout` 用于切换分支及撤销工作区内容的修改

```

# 切换到已有的本地分支 branch1
git checkout branch1

# 切换到远程分支 branch1
git checkout origin/branch1

# 基于当前本地分支创建一个新分支 branch2，并切换至 branch2
git checkout -b branch2

# 基于远程分支 branch1 创建一个新分支 branch2，并切换至 branch2
git checkout origin/branch1 -b branch2

## 当前创建的 branch2 关联的上游分支是 origin/branch1，所以 push 时需要如下命令关联到远程 branch2
git push --set-upstream origin branch2

# 撤销工作区 file 内容的修改。危险操作，谨慎使用
git checkout -- <file>

# 撤销工作区所有内容的修改。危险操作，谨慎使用
git checkout .

```

### git restore: 取消缓存
`git restore` 用于将改动从暂存区退回工作区

```

# 将 a.js 文件取消缓存（取消 add 操作，不改变文件内容）
git reset --staged a.js

# 将所有文件取消缓存
git reset --staged .

```

### git reset: 回滚代码
`git reset` 用于撤销各种 commit 操作，回滚代码

```

# 将某个版本的 commit 从本地仓库退回到工作区（取消 commit 和 add 操作，不改变文件内容）

## 默认不加 -- 参数时时 mixed
git reset --mixed <commit_sha>

# 将某个版本的 commit 从本地仓库退回到缓存区（取消 commit 操作，不取消 add，不改变文件内容）
git reset --soft <commit_sha>

# 取消某次 commit 的记录（取消 commit 和 add，且改变文件内容）
git reset --hard <commit_sha>

## 以上三种操作退回了 commit，都是退回本地仓库的 commit，没有改变远程仓库的 commit。通常再次修改后配合如下命令覆盖远程仓库的 commit：
git push -f

```

## 常用命令
实际的 git 操作场景很多，下面的命令也经常在场景中使用。

### git revert: 取消某次 commit 内容

#### 说明
`git revert` 相比于 `git reset`，会取消某次 commit 更改的内容，但是不会取消掉 commit 记录，而是进行一次新的 commit 去覆盖要取消的那次 commit：

```

# 取消某次 commit 内容，但是保留 commit 记录
git revert <commit-sha>

```

#### 场景
某一版需求中，pm 共提了活动功能、分享功能和视频功能三个功能模块，然后开发老哥做完提测了。上线之前，版本的代码都已经合并到主分支了，pm 突然说这一版活动功能不上线了，下一版再上，分享功能和视频功能正常上线，开发老哥心里直呼 mmp。
研发老哥的 commit 记录如下：
现在想要做的就是取消掉第一次活动功能的 commit，但是视频功能和分享功能的 commit 还需要保留，所以肯定不能使用 `git reset` 了, 这时候 `git revert` 就派上用场了。
执行 `git revert 9ec52dc`，再重新 `git push`，活动功能的 commit 内容就会被覆盖掉了：

### git rebase: 简洁 commit 记录
`git rebase` 命令主要是针对 commit 的，目的是令 commit 记录变得更加简洁清晰。

#### 多次 commit 合并为一次
可以通过 `git rebase -i` 合并多次 commit 为一次。**注意：此操作会修改 commit-sha，因此只能在自己的分支上操作，不能在公共分支操作，不然会引起他人的合并冲突**

##### 说明

```

# 进行 git rebase 可交互命令变基，end-commit-sha 可选，不填则默认为 HEAD

## start 和 end commit-sha 左开右闭原则
git rebase -i <start commit-sha> <end commit-sha>

# 若是中间毫无冲突，变基则一步到位，否则需要逐步调整

# 上次变基为完成，继续上一次的变基操作
git rebase --continue

# 变基有冲突时丢弃有冲突的 commit
git rebase --skip

# 若是变基中途操作错误但是未彻底完成，可以回滚到变基之前的状态
git rebase --abort

```

执行后，会出现可交互命令，界面如下：
  * pick: 是保留该 commit(采用)
  * edit: 一般你提交的东西多了,可以用这个把东东拿回工作区拆分更细的 commit
  * reword: 这个可以重新修改你的 commit msg
  * squash: 内容保留，把提交信息往上一个 commit 合并进去
  * fixup: 保留变动内容，但是抛弃 commit msg

##### 场景
开发老哥在自己的分支开发一个活动功能，共如下 4 次 commit 记录：
要往主分支合并之前，开发老哥决定让 commit 记录简洁一些，于是执行 `git rebase -i edb259`：
上面四行就是我们要进行合并的 commit，我们现在是进入了一个 vim 界面，按 `i` 进行编辑，将活动功能2, 3, 4行改为 s(squash) 如下：
按下 `esc` 退出编辑，再输入 `wq` 退出当前的 vim，会进入到此页面编辑 commit 信息：
我们可以修改 `feat: 活动奖励1` 为 `feat: 活动奖励`，然后 `esc` 退出编辑，再输入 `wq!` 退出当前的 vim。再次 `git push -f` 推送分支，可以看到 commit 已经合并为一次：

#### 使用 rebase 代替 merge

##### 说明
前面说到过 `git pull` = `git fetch` + `git merge`，通过加 --rebase 参数可以启用 rebase 模式， 实际上 `git pull --rebase` = `git fetch` + `git rebase`。
`git rebase` 代替 `git merge` 是现在许多公司和团队要求使用的一种合并方式。相比于 `git merge`，`git rebase` 可以让分支合并后只显示 master 一条线，并且按照 commit 和时间去排序，使得 git 记录简洁和清晰了许多。

```

# 将本地某分支合并至当前分支
git rebase <分支名>

# 将远程某分支合并至当前分支
git rebase <远程主机名> <分支名>

```

##### 场景
假设我们有一个 main 分支，基于 main 分支拉出了一个 feat-1.2 分支。然后在 main 分支先进行了 `feat: 1`、`feat: 2` 两次 commit，再在 feat-1.2 分支进行了 `feat: 3`、`feat: 4` ，最后将 feat-1.2 分支合并至 master 分支。
如果采用 `git merge` 合并，通过 `git log --graph --decorate --all` 查看分支变更图如下：
如果采用 `git rebase` 合并，通过 `git log --graph --decorate --all` 查看分支变更图如下：

### git cherry-pick: 合并指定 commit

#### 说明
`git cherry-pick` 可以选择某次 commit 的内容合并到当前分支

```

# 将 commit-sha1 的变动合并至当前分支
git cherry-pick commit-sha1

# 将多次 commit 变动合并至当前分支
git cherry-pick commit-sha1 commit-sha2

# 将 commit-sha1 到 commit-sha5 中间所有变动合并至当前分支，中间使用..
git cherry-pick commit-sha1..commit-sha5

# pick 时解决冲突后继续 pick
git cherry-pick --continue：

# 多次 pick 时跳过本次 commit 的 pick 进入下一个 commit 的 pick
git cherry-pick --skip

# 完全放弃 pick，恢复 pick 之前的状态
git cherry-pick --abort

# 未冲突的 commit 自动变更，冲突的不要，退出这次 pick
git cherry-pick --quit

```

#### 场景
某开发老哥A和开发老哥B共同开发一次版本需求，开发老哥A拉了一个 `feat-acitivty` 分支开发活动功能，开发老哥B拉了一个 `feat-share` 分支开发分享功能，需要分开提交测试。
开发老哥B开发了一半发现需要用到一个弹窗组件，此时开发老哥A也需要弹窗组件并且已经开发完了，开发老哥A的 commit 如下：
此时 `git cherry-pick` 就起作用了，开发老哥B执行如下命令：`git cherry-pick 486885f`，轻松将弹窗组件的代码也合并进了自己的分支。

### git stash：缓存代码

#### 说明
`git stash` 用于将当前的代码缓存起来，而不必提交，便于下次取出。

```

# 把本地的改动缓存起来
git stash

# 缓存代码时添加备注，便于查找。强烈推荐
git stash save "message"

# 查看缓存记录

## eg: stash@{0}: On feat-1.1: 活动功能
git stash list

# 取出上一次缓存的代码，并删除这次缓存
git stash pop

# 取出 index 为2缓存代码，并删除这次缓存，index 为对应 git stash list 所列出来的
git stash pop stash@{2}

# 取出上一次缓存的代码，但不删除这次缓存
stash apply

# 取出 index 为2缓存代码，但不删除缓存
git stash apply stash@{2}

# 清除某次的缓存
git stash drop stash@{n}

# 清除所有缓存
git stash clear

```

#### 场景
某日开发老哥正愉快地开发着活动功能的代码，突然pm大喊：线上出 bug 了！！于是开发老哥不得不停下手头的工作去修改线上bug，但是开发老哥又不想将现在的活动代码提交，于是开发老哥执行了 stash 命令：`git stash message "活动功能暂存"`，之后转去修复线上 bug 了。

## 其他常用命令
以下命令在开发中也经常用到，强烈推荐大家学习：

### git init: 初始化仓库
`git init` 会在本地生成一个 .git 文件夹，创建一个新的本地仓库：

```
git init

```

### git remote: 关联远程仓库
`git remote` 用于将本地仓库与远程仓库关联

```

# 关联本地 git init 到远程仓库
git remote add origin <git url>

# 新增其他上游仓库
git remote add <git url>

# 移除与远程仓库的管理
git remote remove  <git url>

# 修改推送源
git remote set-url origin <git url>

```

### git status: 查看工作区状态
`git status` 用于查看工作区的文件，有哪些已经添加到了暂存区，哪些没有被添加：

```

# 查看当前工作区暂存区变动
git status

# 以概要形式查看工作区暂存区变动
git status -s

# 查询工作区中是否有 stash 缓存
git status --show-stash

```

### git log: 查看 commit 日志
`git log` 用于查看 commit 的日志

```

# 显示 commit 日志
git log

# 以简要模式显示 commit 日志
git log --oneline

# 显示最近 n 次的 commit 日志
git log -n

# 显示 commit 及分支的图形化变更
git log --graph --decorate

```

### git branch: 管理分支
`git branch` 常用于删除、重命名分支等

```

# 删除分支
git branch -D <分支名>

# 重命名分支
git branch -M <老分支名> <新分支名>

# 将本地分支与远程分支关联
git branch --set-upstream-to=origin/xxx

# 取消本地分支与远程分支的关联
git branch --unset-upstream-to=origin/xxx

```

### git rm：重新建立索引
`git rm` 用于修改 .gitignore 文件的缓存，重新建立索引

```

# 删除某个文件索引（不会更改本地文件，只会是 .gitignore 范围重新生效）
git rm --cache -- <文件名>

# 清除所有文件的索引

## 例如你首次提交了很多文件，后来你建立了一个 .gitignore 文件，有些文件不想推送到远端仓库，但此时有的文件已经被推送了

## 使用此命令可以是 .gitignore 重新作用一遍，从远程仓库中取消这些文件，但不会更改你本地文件
git rm -r --cached .

```

### git diff: 对比差异
`git diff` 用于对比工作区、缓存区、本地仓库以及分支之间的代码差异：

```

# 当工作区有变动，暂存区无变动，对比工作区和本地仓库间的代码差异

#  当工作区有变动和暂存区都有变动，对比工作区和暂存区的代码差异
git diff

# 显示暂存区和本地仓库间的代码差异
git diff --cached

# or
git diff --staged

# 显示两个分支之间代码差异
git diff <分支名1> <分支名2>

```

### git fetch: 获取更新
`git fetch` 用于本地仓库获取远程仓库的更新，不会merge到工作区

```

# 获取远程仓库特定分支的更新
git fetch <远程主机名> <分支名>

# 获取远程仓库所有分支的更新
git fetch --all

```

### git merge: 合并代码
`git merge` 前面在 `git rebase` 内容中也提到过，用于合并代码，用法和 `git rebase` 类似：

```

# 将本地某分支合并至当前分支
git merge <分支名>

# 将远程某分支合并至当前分支
git merge <远程主机名> <分支名>

```

## 总结
以上基本就涵盖了工作中绝大部分场景的 git 命令，掌握了基本可以应对各种 git 操作了。鲁迅说过：一碗酸辣汤，耳濡目染的，不如亲自呷一口的明白。看了这么多建议大家自己建一个测试仓库，亲自敲一下熟悉一下上面命令的用法。
最后总结一个大图：

链接：https://juejin.cn/post/7021023267028729887

**在 Amazon CodeCommit 上创建的空仓库后，第一次从Terminal 提交代码时，以下是完整的步骤和命令用法，包括从设置到提交代码的每一步。**
* * *

### **1. 安装并配置 AWS CLI 和 Git**
确保已经安装 AWS CLI 和 Git。以下是安装和配置步骤：

#### **安装 AWS CLI**
下载并安装 AWS CLI：
`brew install awscli `

#### **配置 AWS CLI**
运行以下命令配置 AWS CLI，输入你的 AWS 访问密钥、密钥 ID 和默认区域：
`aws configure `
  * 提供：
    * **Access Key ID** : 从 AWS IAM 用户获取
    * **Secret Access Key** : 从 AWS IAM 用户获取
    * **Default region** : 例如 `us-east-1`
    * **Output format** : 一般选择 `json`

#### **安装 Git（如果尚未安装）**
`brew install git `

#### **验证 AWS CLI 和 Git 安装**
`aws --version git --version `
* * *

### **2. 克隆 CodeCommit 仓库**
Amazon CodeCommit 提供 HTTPS 和 SSH 两种方式访问仓库。

#### **方法 1：使用 HTTPS（推荐）**
  1. 获取仓库的 HTTPS URL：
     * 登录 AWS Management Console。
     * 转到 **CodeCommit > 仓库 > 点击你的仓库 > 连接**，复制 HTTPS 克隆 URL，例如：
`https://git-codecommit.us-east-1.amazonaws.com/v1/repos/MyRepo `
  2. 配置 Git 凭证助手：
`git config --global credential.helper '!aws codecommit credential-helper $@' git config --global credential.UseHttpPath true `
  3. 克隆仓库：
`git clone https://git-codecommit.us-east-1.amazonaws.com/v1/repos/MyRepo cd MyRepo `

#### **方法 2：使用 SSH**
  1. 配置 SSH 密钥：
     * 生成密钥对：
`ssh-keygen ` * 将公钥上传到 CodeCommit：
`cat ~/.ssh/id_rsa.pub ` * 登录 AWS Console > **IAM > 用户 > 你的用户 > 安全凭证 > SSH 密钥 > 上传密钥**。
  2. 克隆仓库： 获取 SSH URL（类似以下格式）：
`ssh://git-codecommit.us-east-1.amazonaws.com/v1/repos/MyRepo ` 使用以下命令克隆：
`git clone ssh://git-codecommit.us-east-1.amazonaws.com/v1/repos/MyRepo cd MyRepo `

* * *

### **3. 添加代码文件**
将你需要提交的代码或文件添加到克隆的仓库目录中。例如：
`echo "# My First CodeCommit Project" > README.md mkdir src echo "print('Hello, CodeCommit!')" > src/main.py `
* * *

### **4. 初始化 Git 仓库（如果未克隆）**
如果你直接在本地创建了文件夹，而不是克隆的仓库，则需要初始化：
`git init ` 然后关联 CodeCommit 仓库：
`git remote add origin https://git-codecommit.us-east-1.amazonaws.com/v1/repos/MyRepo `
* * *

### **5. 提交代码到 CodeCommit**

#### **步骤 1：检查文件状态**
查看未追踪的文件：
`git status `

#### **步骤 2：添加文件到暂存区**
将所有文件添加到暂存区：
`git add . `

#### **步骤 3：提交文件到本地仓库**
提交代码并添加提交信息：
`git commit -m "Initial commit: added README and main script" `

#### **步骤 4：推送到远程仓库**
将本地提交推送到 CodeCommit：
`git push origin main `
> 如果是第一次推送，可能需要指定分支：
`git push -u origin main `
* * *

### **6. 验证提交**
  1. 登录 AWS Management Console。
  2. 转到 **CodeCommit > 仓库 > 你的仓库 > 代码**。
  3. 确认代码已成功上传。

* * *

### **完整命令总结**
以下是所有命令的顺序：
`# 配置 AWS CLI ` `aws configure ` `# 配置 Git HTTPS 凭证助手 ` `git config --global``credential.helper '!aws codecommit credential-helper $@' ` `git config --global credential.UseHttpPath true ` `# 克隆仓库 ` `git clone https://git-codecommit.us-east-1.amazonaws.com/v1/repos/MyRepo ` `cd MyRepo ` `# 添加代码文件 ` `echo "# My First CodeCommit Project" > README.md ` `mkdir src ` `echo "print('Hello, CodeCommit!')" > src/main.py ` `# 查看 Git 状态 ` `git status ` `# 添加文件到暂存区 ` `git add . ` `# 提交到本地仓库 ` `git commit -m "Initial commit: added README and main script" ` `# 推送到远程仓库 ` `git push -u origin main` **1， 错误修复Untracked files: (use "git add <file>..." to include in what will be committed) .idea/vcs.xml，**

### 错误分析
错误提示表明，`.idea/vcs.xml` 文件是**未跟踪文件** （Untracked file），但还未被添加到 Git 的跟踪中。这会导致 Git 在你尝试推送或提交时报告错误。

### 修复方法

#### 方法 1: 添加未跟踪文件
如果 `.idea/vcs.xml` 是需要被版本控制的一部分：
  1. 将该文件添加到暂存区：
`git add .idea/vcs.xml `
  2. 提交更改：
`git commit -m "Add .idea/vcs.xml" `
  3. 推送到远程仓库：
`git push origin <branch-name> `

#### 方法 2: 忽略文件
如果 `.idea/vcs.xml` 是不需要提交的文件（例如 IDE 的配置文件），可以将其添加到 `.gitignore`：
  1. 编辑 `.gitignore` 文件（若不存在则创建一个）：
`nano .gitignore `
  2. 添加忽略规则：
`.idea/ `
  3. 更新 `.gitignore` 后的配置：
`git add .gitignore git commit -m "Update .gitignore to ignore IDE files" git push origin <branch-name> `

* * *

### 其他常见的 Git 提交错误和解决方法

#### 1. **冲突错误 (Merge Conflict)**
**错误描述：**
`CONFLICT (content): Merge conflict in <file>` `Automatic merge failed; fix conflicts and then commit the result. ` **修复方法：**
  1. 打开冲突文件，按照 Git 标记解决冲突：
`<<<<<<< HEAD ` `本地版本代码 ` `======= ` `远程版本代码 ` `>>>>>>>``remote/origin`
  2. 修改后，标记为已解决：
`git add <file> `
  3. 提交修改：
`git commit -m "Resolve merge conflict" `

* * *

#### 2. **拒绝推送错误 (Push Rejected)**
**错误描述：**
`! [rejected] main -> main (non-fast-forward) ` **原因：** 本地分支落后于远程分支。
**修复方法：**
  1. 拉取最新代码并合并：
`git pull origin main `
  2. 解决冲突后，重新推送：
`git push origin main `

* * *

#### 3. **“Detached HEAD” 错误**
**错误描述：**
`You are in 'detached HEAD' state. ` **原因：** 检出了某个具体的提交或远程分支，而不是本地分支。
**修复方法：**
  1. 返回到指定分支：
`git checkout <branch-name> `
  2. 如果需要保存更改：
`git checkout -b <new-branch> `

* * *

#### 4. **子模块相关错误**
**错误描述：**
`fatal: No url found for submodule path '<path>' in .gitmodules ` **修复方法：**
  1. 初始化子模块：
`git submodule init `
  2. 更新子模块：
`git submodule update `

* * *

#### 5. **文件过大提交错误**
**错误描述：**
`error: File <file> exceeds GitHub's file size limit of 100.00 MB ` **修复方法：**
  1. 使用 Git LFS（大文件存储）：
`git lfs track "<file>" ` `git add .gitattributes ` `git add <file> ` `git commit -m "Track large file with Git LFS" ` `git push origin <branch-name> `

* * *

#### 6. **缺少提交信息的错误**
**错误描述：**
`Aborting commit due to empty commit message. ` **修复方法：**
  1. 在提交时添加非空信息：
`git commit -m "Describe your changes"`

* * *

### **故障排查**
  * 如果无法连接，请检查 IAM 用户是否有 `AWSCodeCommitFullAccess` 权限。
  * 如果 `git push` 提示权限问题，确保 `aws configure` 的凭证正确或 SSH 密钥已配置。
  * 如果分支不存在，使用以下命令创建并推送分支：
`git checkout -b main git push -u origin main` **--------------------------------------------------------------** **运行`git commit -a` 后，Git 会打开默认的文本编辑器（如 Vim、Nano 等）来编辑提交信息。以下是详细的操作步骤和可用命令：**
* * *

### **1. 编辑提交信息**
    * 运行 `git commit -a` 后，Git 会打开默认编辑器。
    * 在编辑器中，你会看到类似以下内容：

```

# Please enter the commit message for your changes. Lines starting

# with '#' will be ignored, and an empty message aborts the commit.
#

# On branch main

# Changes to be committed:

#       modified:   file1.txt

#       modified:   file2.txt
#
```

    * 在第一行输入提交信息，例如：

```
Fix bug in file1.txt and improve file2.txt
```

    * 如果需要多行提交信息，可以在第一行后空一行，继续写详细描述。
* * *

### **2. 保存并退出编辑器**
    * **Vim 编辑器** ：
      * 按 `i` 进入插入模式，输入提交信息。
      * 按 `Esc` 退出插入模式。
      * 输入 `:wq` 保存并退出。
    * **Nano 编辑器** ：
      * 直接输入提交信息。
      * 按 `Ctrl + O` 保存，然后按 `Enter` 确认。
      * 按 `Ctrl + X` 退出。
    * 其他编辑器：
      * 参考编辑器的保存和退出命令。
* * *

### **3. 取消提交**
    * 如果想取消提交：
      * 删除所有非注释内容（不以 `#` 开头的行），保存并退出。
      * Git 会提示：

```
Aborting commit due to empty commit message.
```

表示提交已取消。
* * *

### **4. 提交后可用的命令**
提交完成后，你可以使用以下命令查看或修改提交：

#### **查看提交记录**
    * 查看最近提交记录：

```
git log
```

    * 查看简化的提交记录：

```
git log --oneline
```

#### **修改最后一次提交**
    * 如果提交信息有误，可以修改最后一次提交：

```
git commit --amend
```

这会重新打开编辑器，允许你修改提交信息或添加新的更改。

#### **撤销提交**
    * 撤销最后一次提交，但保留更改：

```
git reset HEAD~
```

    * 撤销提交并丢弃更改：

```
git reset --hard HEAD~
```

#### **查看状态**
    * 查看当前 Git 状态：

```
git status
```

#### **推送提交**
    * 将提交推送到远程仓库：

```
git push origin <branch-name>
```

* * *

### **5. 常见问题**
    * **编辑器无法打开** ：
      * 确保 Git 的默认编辑器配置正确：

```
git config --global core.editor "vim"
```

      * 如果不想使用编辑器，可以直接在命令行提交：

```
git commit -a -m "Your commit message"
```

    * **提交信息写错了** ：
      * 使用 `git commit --amend` 修改最后一次提交。