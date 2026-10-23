# SciNode

个人科研可视化 AI 工作流：项目分类、任务规划、科研工具、运行摘要、人工审核、版本记录与成果冻结。

## 现在先看什么

- [打开科研工作台](http://127.0.0.1:5173/research)。双击 `启动SciNode.command` 后使用个人账户登录。
- [双 PostgreSQL 需求驱动数据提取](http://127.0.0.1:5173/research/bc6a5382-0f82-4186-8118-c380ab0287a5)：填写需求 → 检查实际表结构 → 模型生成 SQL → 人工确认 → 本地只读提取与表格预览 → 下载成果包。
- 具体操作见[使用指南](SciNode使用指南.md#双-postgresql-需求提取)；安装与服务管理见[本地部署说明](本地部署说明.md)。

## 怎样使用和更新

在工作台打开项目，选择节点修改任务和资料，保存后运行；到人工确认节点时检查材料并作出决定。运行记录保留当次需求、配置、模型、输出及审核意见；成果检查后可冻结。模型设置提供实际模型列表和连接测试，全局与项目设置支持 Agent 规则、Skills 和 MCP。

PostgreSQL 流程默认读取本机 `5432/mimiciv` 与 `5433/mimiciii`；修改第一个节点可更换目标库和提取需求。需求与真实表结构交给模型，查询结果保留本机。数据库凭据交由本机 libpq 认证，不填入节点或提示词。提取节点使用的 Python 依赖见 [scripts/requirements-postgres.txt](scripts/requirements-postgres.txt)，部署路径和输入格式见使用指南。

`停止SciNode.command`、`查看SciNode状态.command` 管理本机服务。前端开发在 `frontend/` 执行 `npm run build`，修改文件用项目 ESLint 检查；后端使用 Java 21 与 Maven `test package`。服务命令为 `python3 deploy/local/manage.py start|stop|status`。

## 文件放在哪里

| 路径 | 用途 | 主要输入与输出 | 使用入口 |
|---|---|---|---|
| [SciNode使用指南.md](SciNode使用指南.md) | 当前操作说明 | 节点配置、助手、审核、下载与冻结 | 先按所需功能阅读 |
| [frontend/](frontend/) | 页面和工作流画布 | 项目、运行状态、表格预览及下载控件 | `npm run build` |
| [backend/](backend/) | 本机 API 和执行服务 | 认证、配置、模型调用、脚本与成果管理 | Maven；部署命令 |
| `backend/scinode-data/`（本机生成，不入库） | 科研项目及运行资料 | 项目定义、原始资料副本、运行记录与成果；也支持指定外部工作目录 | 工作台“运行与成果” |
| [scripts/](scripts/) | 可复用执行代码与检查 | PostgreSQL 只读连接、结构读取、CSV/JSONL 导出及测试 | 工作流的 Python 节点；代码已嵌入运行定义 |
| [deploy/local/](deploy/local/) | 本机服务与私有配置 | 仅 `bootstrap.py`、`manage.py` 入库；凭据、运行环境、数据库和备份在本机生成 | `manage.py`；本地部署说明 |
| `artifacts/`（本机生成，不入库） | 本地开发验收资料 | 验收状态、截图与一次性配置脚本 | 本机 `artifacts/postgres-workflow-acceptance.json` |

## 当前做到哪里

双 PostgreSQL 流程已完成正式模型 `本地网关8317.gpt-6.1-sol` 的端到端运行：界面人工确认后，从两个真实数据库只读提取，输出表格并生成 CSV、JSONL、SQL/参数记录与 ZIP；三种下载已实际检查。当前示例统计非系统 schema 的表或视图数量，5432 返回 4 行、5433 返回 1 行。默认每查询最多 5,000 行、预览前 20 行；按需可设置最高 100,000 行，达到截取条件时显示标记。

当前流程可使用，下一步是在第一个节点填写你的实际提取要求，并核对新的查询方案。实现与本次验收记录在固定文件中更新，演示和实际研究的每次运行在应用内分别记录。

## Git 记录范围

关联仓库：[jialeyang0104/SciNode](https://github.com/jialeyang0104/SciNode)。源码、测试、依赖清单与锁文件、配置示例、网站图标、使用文档和部署脚本纳入版本管理。

`.gitignore` 排除真实 `.env`、密钥、数据库存储与导出、个人科研项目和对话、运行成果、日志、构建产物、依赖目录、开发工具内部资料及两个本机专用验收脚本。现有本机文件保持原位。新增环境示例使用 `.env.example`；提交前用 `git status --short` 与 `git diff --cached` 检查实际记录范围。

从 Git 获取的是软件实现。上面的本机演示项目、验收截图、个人账户、模型连接和科研资料随本机部署保存；新机器需另行配置环境、数据库与模型服务，参照[本地部署说明](本地部署说明.md)。Git 之外的个人资料仍需单独备份。

## 哪些内容需要保留

保留原始资料、人工确认记录、项目历史及已冻结成果；修改任务后运行新的提取，不覆盖旧成果。备份应同时包含 MySQL、`backend/scinode-data/` 和项目指定的外部工作目录。模型连接及数据库凭据留在私有配置中。

本机端口：前端 5173、后端 8084、MySQL 3307、Redis 6380。私有配置位于 `backend/.env` 和 `deploy/local/`。

[第三方署名](THIRD_PARTY_NOTICES.md)
