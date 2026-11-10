# 任务执行与复现资源

本目录是运行时 Python 代码的唯一源位置。Java 执行器从 classpath 复制实际使用的文件到每个任务的 `src/`，保存解析后的参数并运行。修改这里后重新构建后端；旧运行保留原代码。

| 文件 | 职责 | 输入与输出 |
|---|---|---|
| `tabular_data.py` | CSV/XLSX 读取、表头检查、前 20 行预览与数据字典 | 原始表格 → 本地预览、字典和源文件哈希 |
| `clinical_analysis.py` | 数据质量、Table 1、Logistic/Cox、KM 与预测模型内部验证 | `analysisPreset`、`analysis`、数据路径 → Markdown、CSV、PNG/PDF、模型文件 |
| `document_tool.py` | Word/PDF/文本读取与导出 | 文档/文字/段落补丁 → 文档产物 |
| `task_package.py` | 按任务打包，保留原件、代码、审核与哈希 | 运行成果清单 → `research-package.zip` |
| `execution_runner.py` | 捕获实际 Python 解释器与已安装依赖，再执行任务 | 实际脚本 → `config/environment.json`、`requirements.txt`、任务产物 |
| `reproduce.py` | 在解压包中复现一个本地任务 | 任务 ID、空输出目录 → 复现结果；先校验哈希并替换登记过的路径 |
| `requirements-clinical.txt` | 临床功能支持的依赖范围 | 使用 `SCINODE_PYTHON` 安装；当次实际版本另存于任务记录 |

通用执行约定：`SCINODE_INPUT` 指向实际输入 JSON，`SCINODE_OUTPUT` 指向任务结果目录；脚本将机器可读结果写入 `result.json`。输入原件始终在运行目录之外。

前后关系：`ResearchService` 解析依赖并准备任务 → `ResearchToolExecutor` 选择解释器与脚本 → 当前目录资源生成结果 → 服务收集文件及哈希 → 前端按任务显示 → 成果整理节点生成可携带的复现包。

完整检查见 [根使用指南](../../../../../SciNode使用指南.md#任务文件与复现)。本机离线统计检查在仓库根目录运行：

```sh
/实际/Python路径 scripts/test_clinical_workflow.py
```

Java 执行集成测试使用 `-Dscinode.test-python=/实际/Python路径`，验证真实导入、分析、导出、打包、冻结后复用及移除原件后的复现。
