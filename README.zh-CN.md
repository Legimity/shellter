<img src="docs/assets/shellter-icon.png" width="128" height="128" alt="Shellter：背着家迁移的寄居蟹" />

# Shellter

**给你的 agents，一个能带走的家。**

[下载](https://github.com/Legimity/shellter/releases/latest) · [快速开始](#快速开始) · [English](README.md) · [反馈问题](https://github.com/Legimity/shellter/issues)

换 coding agent、换开发机时，把已经调好的 Skills 与 MCP 配置带过去。Shellter 提供本地网页和 CLI，帮助你选择资源、查看差异、打包迁移，并在需要时回退配置变更。

![Shellter 本地工作台](docs/assets/workbench.jpg)

## 带走你的工作环境

- **切换 Agent：** 复用选定的 Skills，减少手工复制与重复配置。
- **迁移机器：** 导出 ZIP，通过自己的方式传输，在目标机器映射路径。
- **写入前预览：** 查看目标文件和前后内容，明确处理冲突。
- **需要时回退：** 恢复已记录的配置写入，遇到后续编辑时先提示冲突。
- **凭据留在本机：** 搬运配置与引用，在目标客户端完成认证。

已有 Codex CLI、Claude Code、CodeBuddy Code CLI 和 Cursor 的配置适配器。具体版本与资源类型请查看[兼容范围](docs/COMPATIBILITY.md)。

![本机分发与跨机迁移](docs/assets/workflow.svg)

## 快速开始

需要 **Node.js 24** 和 npm。先用临时示例体验，不需要 API key，也不需要安装 coding agent。

```bash
git clone https://github.com/Legimity/shellter.git
cd shellter
npm ci
npm run demo
```

打开终端打印的本地链接，选择示例 Skill，预览、应用，再回退。[新手指南](docs/GETTING-STARTED.zh-CN.md)提供逐步说明。界面支持中英文切换。

也可以从 [Releases](https://github.com/Legimity/shellter/releases/latest) 下载 **`shellter-0.1.0-node24.zip`**，解压后在目录内执行 `npm ci --omit=dev`，再运行 `npm run demo`，无需构建源码。

使用自己的配置时，停止示例并运行 `npm start`，在界面中选择来源、目标和资源。无桌面环境、自定义配置目录及完整命令见 [CLI 指南](docs/CLI.md)。

## 已完成真实跨机迁移

一次 macOS → Ubuntu 迁移将 **47 个 Skills、112 个文件**分别迁入 tclaude 和 CodeBuddy。两端各实际调用一个迁入 Skill 成功；tclaude 发现全部 47 个。独立跨机 MCP 测试包也完成了原生调用和回退。[查看验证记录与范围](docs/REMOTE-MIGRATION.md)。

## 文档与参与

- [新手指南](docs/GETTING-STARTED.zh-CN.md) · [CLI](docs/CLI.md) · [操作演示](docs/DEMO.md)
- [兼容范围](docs/COMPATIBILITY.md) · [发布说明](docs/RELEASE-NOTES.md)
- [贡献指南](CONTRIBUTING.md) · [开发文档](docs/DEVELOPMENT.md) · [安全问题](SECURITY.md)

欢迎[反馈你的迁移结果](https://github.com/Legimity/shellter/issues/new/choose)，一起补齐不同客户端、版本和机器的兼容性。

采用 [MIT 许可证](LICENSE)，保留依赖的[第三方许可声明](THIRD-PARTY-NOTICES.txt)。
