# SciNode Backend

Java 21 / Spring Boot 服务提供认证、模型配置、科研项目、版本、工具执行、成果下载及冻结。

```sh
mvn test
mvn package
mvn spring-boot:run
```

私有环境配置在 `.env`，本地科研项目保存在 `scinode-data/`。启动时连接 MySQL 与 Redis。账户、模型密钥和数据库密码通过私有部署配置提供。
