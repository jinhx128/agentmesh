# AgentMesh GitHub Release Checklist

`schema_version`: 1

本文件定义 GitHub Releases 页面可见的发布流程。只推送 git tag 不算完成发布；
完成发布必须能通过 `gh release view <tag>` 查到非 draft Release，并看到完整资产。

## 发布定义

一次 GitHub Release 必须同时满足：

- `main` 已推送到 `origin/main`。
- 当前版本存在本地 annotated tag，例如 `v0.1.2`。
- 同名 tag 已推送到 `origin`。
- GitHub Release 页面存在同名 Release，且不是 draft / prerelease。
- Release assets 至少包含：
  - `agentmesh-<version>.tgz`
  - `AgentMesh_<version>_aarch64.dmg`
  - `agentmesh-skill-<version>.md`
  - `SHA256SUMS`
- `npm run release:github:verify` 通过。

## 前置条件

- `package.json`、workspace package versions、Tauri/Cargo 版本和文档版本已经同步。
- `changelog/` 已记录本次发布。
- `npm test`、`cargo check`、`npm run studio-desktop:package:dev` 和 DMG build 已通过。
- 本机已安装并登录 GitHub CLI：`gh auth status`。
- 本机可运行 Rust/Tauri DMG build。
- 创建或补传 Release 时，当前 HEAD 必须正好是 `v<version>` 指向的 commit，
  且工作区必须干净；脚本会强制检查，防止发布后本地继续变更时覆盖同版本资产。

## 标准流程

1. 确认工作区和远端状态：

```sh
git status -sb
git fetch origin main --tags
git status -sb
```

2. 提交版本和日志：

```sh
git add <changed-files>
git diff --cached --check
git commit -m "release: 发布 <version>"
```

3. 创建并推送 tag：

```sh
git tag -a v<version> -m "发布 v<version>"
git push origin main v<version>
```

4. 创建 GitHub Release 并上传资产：

```sh
npm run release:github -- --notes-file <release-notes.md>
```

如果没有传 `--notes-file`，脚本会生成一份包含资产清单和安装 / 升级边界的临时
release notes。正式发布应优先提供人工整理过的 notes，并至少说明：

- Desktop Studio 必须用同版本 DMG 完整替换 `AgentMesh.app`，不要混用旧 app
  resources、sidecar 或 UI assets。
- DMG 是否签名、是否 notarized、目标架构，以及首次打开 / Gatekeeper 限制。
- PATH-visible CLI 是独立安装渠道，需要用同版本 tarball 重新 `npm install -g`。
- app-managed command-line wrapper 在移动或替换 `AgentMesh.app` 后需要重新安装。

5. 验证 GitHub Release：

```sh
npm run release:github:verify
```

验证必须检查到 Release 不是 draft / prerelease，四个资产都已上传。`npm run
release:github` 在创建或补传资产后会立即比较远端资产 digest 与本地
`dist-release/` 文件；发布后如果工作区继续变化，单独 verify 默认不再比较本地
tarball，避免把新构建产物误判成已发布产物。

需要强制比较当前本地 `dist-release/` 时：

```sh
npm run release:github:verify -- --compare-local
```

## 资产准备

只准备本地资产、不触碰 GitHub：

```sh
npm run release:assets
```

复用已存在的 `dist-node` 和 DMG：

```sh
npm run release:assets -- --skip-build
```

脚本会生成或刷新：

- `dist-release/agentmesh-<version>.tgz`
- `dist-release/AgentMesh_<version>_aarch64.dmg`
- `dist-release/agentmesh-skill-<version>.md`
- `dist-release/SHA256SUMS`

## 漏发补救

如果 tag 已经推送，但 GitHub Releases 页面看不到新版本，先确认：

```sh
git ls-remote --tags origin v<version>
gh release view v<version> --repo jinhx128/agentmesh
```

当 tag 存在而 `gh release view` 返回 `release not found` 时，执行：

```sh
npm run release:github -- --notes-file <release-notes.md>
npm run release:github:verify
```

脚本发现 Release 已存在时，会使用 `gh release upload --clobber` 覆盖上传同名资产，
然后再次验证，适合补传或修复缺失资产。
覆盖上传仍要求当前 HEAD 等于当前版本 tag，且工作区干净。

## 失败处理

- 缺本地 tag：先创建 annotated tag，不要让脚本隐式创建 tag。
- 缺远端 tag：先 `git push origin v<version>`，再创建 Release。
- 缺 DMG：去掉 `--skip-build`，或先运行 Tauri DMG build。
- HEAD 不等于 tag：切回对应 release commit，或先创建新的版本/tag，不要覆盖旧版本资产。
- 工作区不干净：先提交或 stash。只有恢复半失败发布且确认资产来自同一 commit 时，才使用
  `--allow-dirty`。
- `gh` 未登录：运行 `gh auth login` 或切换到已授权环境。
- 验证失败：不要宣布发布完成；修复缺失资产或 Release 状态后重新运行
  `npm run release:github:verify`。
