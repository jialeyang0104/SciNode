# 项目脚本

| 入口 | 用途 | 输入与输出 |
|---|---|---|
| `postgres_workflow.py` | PostgreSQL 只读结构读取与结果导出 | 已确认 SQL/参数 → CSV、JSONL、预览及执行记录；依赖 `requirements-postgres.txt` |
| `test_postgres_workflow.py` | SQL 限制、导出和双库验收 | 固定查询及本机数据库 → 测试报告 |
| `test_clinical_workflow.py` | 临床统计与复现包验收 | 临时固定数据 → 统计量检查、CSV/XLSX 预览、图表和解压复现；自动清理临时目录 |
| `index_research_workspaces.py` | 为已有项目、运行和旧任务补充阅读导航 | 本机数据记录 → 固定位置 README；记录、原件、冻结成果保持原位 |

统计执行源码集中在 [后端运行资源](../backend/src/main/resources/scinode/README.md)，不要在 scripts 中再维护副本。

在仓库根目录运行临床验收：

```sh
/实际/Python路径 scripts/test_clinical_workflow.py
```

为本机现有记录更新导航：

```sh
python3 scripts/index_research_workspaces.py --data-dir backend/scinode-data
```

有历史目录迁移时，追加与私有后端配置一致的 `--previous-root /原路径 --current-root /当前路径`。根项目入口见 [README](../README.md)，应用内操作见 [使用指南](../SciNode使用指南.md)。
