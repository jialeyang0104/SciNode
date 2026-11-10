# SciNode Backend

Java 21 / Spring Boot 服务提供认证、模型配置、科研项目、版本、工具执行、成果下载及冻结。

```sh
mvn test
mvn package
mvn spring-boot:run
```

私有环境配置在 `.env`，本地科研项目保存在 `scinode-data/`。启动时连接 MySQL 与 Redis。账户、模型密钥和数据库密码通过私有部署配置提供。


临床模板、PubMed 与任务目录分别由 `ClinicalTemplates`、`PubMedClient`、`TaskWorkspace` 负责；`ClinicalDataPolicy` 检查临床工作流的模型/联网资料引用。原有 REST 接口继续使用，新增 `GET /api/research/projects/{id}/files/{fileId}/preview?sheet=...` 用于本机表格预览。

统计和文档执行代码从 [运行资源目录](src/main/resources/scinode/README.md) 加载。用 `SCINODE_PYTHON` 对应解释器安装 `src/main/resources/scinode/requirements-clinical.txt`；Word/PDF 使用 `SCINODE_DOCUMENT_PYTHON`。

隔离回归和真实执行测试：

```sh
mvn '-Dtest=!SciNodeApplicationTests' -Dscinode.test-python=/实际/Python路径 test package
```

追加 `-Dscinode.test-pubmed=true` 验收真实 PubMed 摘要。测试只使用临时数据；完整应用上下文测试读取本机配置，另在专用环境执行。
