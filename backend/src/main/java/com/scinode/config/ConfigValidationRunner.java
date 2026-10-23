package com.scinode.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;

/**
 * 启动配置校验器
 * 在应用启动时检查关键配置的安全性
 */
@Component
public class ConfigValidationRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ConfigValidationRunner.class);

    // 弱 JWT secret 黑名单（常见默认值）
    private static final String[] WEAK_JWT_SECRETS = {
        "scinode-one-jwt-secret-key-change-me-to-a-long-random-string",
        "scinode-dev-jwt-secret-key-only-for-development",
        "secret",
        "password",
        "123456",
        "jwt-secret",
        "your-secret-key",
        "default-secret"
    };

    // 最小 JWT secret 长度（字符数）
    private static final int MIN_JWT_SECRET_LENGTH = 32;

    @Autowired
    private JwtSecretProvider jwtSecretProvider;

    @Autowired(required = false)
    private DataSource dataSource;

    @Value("${spring.datasource.url:}")
    private String datasourceUrl;

    @Value("${spring.datasource.username:}")
    private String datasourceUsername;

    @Value("${spring.datasource.password:}")
    private String databasePassword;

    @Value("${minio.accessKey:}")
    private String minioAccessKey;

    @Value("${minio.secretKey:}")
    private String minioSecretKey;

    @Value("${scinode.default-username:}")
    private String defaultUsername;

    @Value("${scinode.default-password:}")
    private String defaultPassword;

    /**
     * 校验默认管理员账户配置
     */
    private void validateDefaultCredentials() {
        if (defaultUsername == null || defaultPassword == null) {
            log.info("ℹ️  未配置默认管理员账户（生产环境建议）");
            return;
        }

        String trimmedUsername = defaultUsername.trim();
        String trimmedPassword = defaultPassword.trim();

        if (trimmedUsername.isEmpty() && trimmedPassword.isEmpty()) {
            log.info("ℹ️  默认管理员账户已禁用");
            return;
        }

        // 检查弱密码
        if (trimmedPassword.length() < 8) {
            log.warn("==========================================");
            log.warn("⚠️  默认管理员密码过弱！");
            log.warn("   当前密码长度: {} 字符（建议至少 8 字符）", trimmedPassword.length());
            log.warn("   生产环境必须使用强密码！");
            log.warn("   建议：不配置默认账户，或使用强密码");
            log.warn("==========================================");
        }

        // 检查是否为常见默认值
        if ("admin".equals(trimmedUsername) && ("admin".equals(trimmedPassword) || "123".equals(trimmedPassword) || "123456".equals(trimmedPassword))) {
            log.warn("==========================================");
            log.warn("⚠️  使用了默认管理员账户的弱密码！");
            log.warn("   检测到: {}/{}", trimmedUsername, trimmedPassword);
            log.warn("   生产环境必须修改！");
            log.warn("==========================================");
        } else {
            log.info("✅ 默认管理员账户已配置");
        }
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        validateJwtSecret();
        validateDatabasePassword();
        validateMinioCredentials();
        validateDefaultCredentials();
    }

    /**
     * 校验 JWT Secret 强度
     */
    private void validateJwtSecret() {
        if (jwtSecretProvider.isGeneratedForLocalDevelopment()) {
            log.warn("==========================================");
            log.warn("⚠️  当前未显式配置可用的 JWT_SECRET，已自动生成临时开发密钥");
            log.warn("   触发原因: {}", "missing".equals(jwtSecretProvider.getGenerationReason()) ? "未配置 JWT_SECRET" : "检测到仓库默认弱密钥");
            log.warn("   当前进程可正常开发调试，但重启后旧 Token 会失效");
            log.warn("   生产环境务必显式设置强 JWT_SECRET");
            log.warn("==========================================");
            log.info("✅ 已启用临时开发 JWT_SECRET（长度: {} 字符）", jwtSecretProvider.getSecret().length());
            return;
        }

        String trimmedSecret = jwtSecretProvider.getSecret() == null ? "" : jwtSecretProvider.getSecret().trim();
        if (trimmedSecret.isEmpty()) {
            log.error("==========================================");
            log.error("❌ JWT_SECRET 未配置！");
            log.error("   请通过环境变量 JWT_SECRET 设置 JWT 密钥");
            log.error("   生产环境必须使用强密钥（至少 32 位随机字符串）");
            log.error("==========================================");
            throw new IllegalStateException("JWT_SECRET is required");
        }

        // 检查是否为弱密钥
        for (String weakSecret : WEAK_JWT_SECRETS) {
            if (weakSecret.equals(trimmedSecret)) {
                log.error("==========================================");
                log.error("❌ 使用了弱 JWT_SECRET！");
                log.error("   检测到默认/弱密钥: {}", weakSecret.substring(0, Math.min(30, weakSecret.length())) + "...");
                log.error("   生产环境必须修改为强密钥！");
                log.error("   建议使用：openssl rand -base64 32 生成");
                log.error("==========================================");
                throw new IllegalStateException("Weak JWT_SECRET detected");
            }
        }

        // 检查长度
        if (trimmedSecret.length() < MIN_JWT_SECRET_LENGTH) {
            log.warn("==========================================");
            log.warn("⚠️  JWT_SECRET 长度不足！");
            log.warn("   当前长度: {} 字符（建议至少 {} 字符）", trimmedSecret.length(), MIN_JWT_SECRET_LENGTH);
            log.warn("   弱密钥容易被暴力破解，建议使用 32+ 位随机字符串");
            log.warn("==========================================");
        } else {
            log.info("✅ JWT_SECRET 配置检查通过（长度: {} 字符）", trimmedSecret.length());
        }
    }

    /**
     * 校验数据库密码（开发环境警告，生产环境强制要求）
     */
    private void validateDatabasePassword() {
        if (databasePassword == null || databasePassword.trim().isEmpty()) {
            log.warn("==========================================");
            log.warn("⚠️  MYSQL_PASSWORD 未配置！");
            log.warn("   请通过环境变量 MYSQL_PASSWORD 设置数据库密码");
            log.warn("==========================================");
            validateEmptyDatabasePasswordConnection();
            return;
        }

        String trimmedPassword = databasePassword.trim();
        if (trimmedPassword.equals("123456") || trimmedPassword.equals("password") || trimmedPassword.equals("root")) {
            log.warn("==========================================");
            log.warn("⚠️  使用了弱数据库密码！");
            log.warn("   检测到常见弱密码: {}", trimmedPassword);
            log.warn("   生产环境必须使用强密码！");
            log.warn("==========================================");
        } else {
            log.info("✅ 数据库密码已配置");
        }
    }

    private void validateEmptyDatabasePasswordConnection() {
        if (dataSource == null) {
            return;
        }

        try (Connection ignored = dataSource.getConnection()) {
            log.warn("⚠️  当前数据库接受空密码配置，将继续启动（仅建议本地开发使用）");
        } catch (SQLException ex) {
            log.error("==========================================");
            log.error("❌ 当前数据库不接受空密码，应用将无法正常访问数据库！");
            log.error("   数据库地址: {}", datasourceUrl);
            log.error("   数据库用户: {}", datasourceUsername);
            log.error("   请设置 MYSQL_PASSWORD 后重新启动，例如：");
            log.error("   MYSQL_PASSWORD=你的数据库密码 ./mvnw spring-boot:run");
            log.error("==========================================");
            throw new IllegalStateException("MYSQL_PASSWORD is required for the current database", ex);
        }
    }

    /**
     * 校验 MinIO 凭证（开发环境警告）
     */
    private void validateMinioCredentials() {
        if (minioAccessKey == null || minioSecretKey == null) {
            log.warn("==========================================");
            log.warn("⚠️  MinIO 凭证未完全配置！");
            log.warn("   请配置 MINIO_ACCESS_KEY 和 MINIO_SECRET_KEY");
            log.warn("==========================================");
            return;
        }

        // 检查是否为默认凭证
        String trimmedAccessKey = minioAccessKey.trim();
        String trimmedSecretKey = minioSecretKey.trim();
        if ("minioadmin".equals(trimmedAccessKey) && "minioadmin".equals(trimmedSecretKey)) {
            log.warn("==========================================");
            log.warn("⚠️  使用了 MinIO 默认凭证！");
            log.warn("   检测到默认账号: minioadmin / minioadmin");
            log.warn("   生产环境必须修改！");
            log.warn("==========================================");
        } else {
            log.info("✅ MinIO 凭证已配置");
        }
    }
}
