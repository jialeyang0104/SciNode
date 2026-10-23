package com.scinode.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.Set;

/**
 * 统一解析 JWT Secret。
 * 本地开发场景下，如果未显式配置或仍使用仓库默认弱密钥，则自动生成一次临时强密钥，
 * 避免 spring-boot:run 被默认配置直接拦住。
 */
@Component
public class JwtSecretProvider {

    private static final Set<String> WEAK_JWT_SECRETS = Set.of(
            "scinode-one-jwt-secret-key-change-me-to-a-long-random-string",
            "scinode-dev-jwt-secret-key-only-for-development",
            "secret",
            "password",
            "123456",
            "jwt-secret",
            "your-secret-key",
            "default-secret"
    );

    private final Environment environment;
    private final String configuredSecret;
    private final String datasourceUrl;
    private final String minioEndpoint;
    private final boolean devtoolsRestartEnabled;

    private volatile String effectiveSecret;
    private volatile boolean generatedForLocalDevelopment;
    private volatile String generationReason;

    public JwtSecretProvider(
            Environment environment,
            @Value("${scinode.auth.jwt-secret:}") String configuredSecret,
            @Value("${spring.datasource.url:}") String datasourceUrl,
            @Value("${minio.endpoint:}") String minioEndpoint,
            @Value("${spring.devtools.restart.enabled:false}") boolean devtoolsRestartEnabled
    ) {
        this.environment = environment;
        this.configuredSecret = configuredSecret == null ? "" : configuredSecret.trim();
        this.datasourceUrl = datasourceUrl == null ? "" : datasourceUrl.trim();
        this.minioEndpoint = minioEndpoint == null ? "" : minioEndpoint.trim();
        this.devtoolsRestartEnabled = devtoolsRestartEnabled;
    }

    public String getSecret() {
        if (effectiveSecret == null) {
            synchronized (this) {
                if (effectiveSecret == null) {
                    resolveSecret();
                }
            }
        }
        return effectiveSecret;
    }

    public boolean isGeneratedForLocalDevelopment() {
        getSecret();
        return generatedForLocalDevelopment;
    }

    public boolean hasExplicitSecret() {
        return !configuredSecret.isEmpty();
    }

    public boolean isConfiguredSecretWeakDefault() {
        return WEAK_JWT_SECRETS.contains(configuredSecret)
                || configuredSecret.endsWith("-one-jwt-secret-key-change-me-to-a-long-random-string")
                || configuredSecret.endsWith("-dev-jwt-secret-key-only-for-development");
    }

    public String getGenerationReason() {
        getSecret();
        return generationReason;
    }

    private void resolveSecret() {
        if (!configuredSecret.isEmpty() && !isConfiguredSecretWeakDefault()) {
            effectiveSecret = configuredSecret;
            generatedForLocalDevelopment = false;
            generationReason = null;
            return;
        }

        if (isLikelyLocalDevelopment()) {
            effectiveSecret = generateRandomSecret();
            generatedForLocalDevelopment = true;
            generationReason = configuredSecret.isEmpty() ? "missing" : "weak-default";
            return;
        }

        effectiveSecret = configuredSecret;
        generatedForLocalDevelopment = false;
        generationReason = null;
    }

    private boolean isLikelyLocalDevelopment() {
        String[] activeProfiles = environment.getActiveProfiles();
        boolean productionProfileActive = Arrays.stream(activeProfiles)
                .map(String::toLowerCase)
                .anyMatch(profile -> profile.equals("prod") || profile.equals("production"));
        if (productionProfileActive) {
            return false;
        }

        boolean localProfileActive = Arrays.stream(activeProfiles)
                .map(String::toLowerCase)
                .anyMatch(profile -> profile.equals("local") || profile.equals("dev") || profile.equals("test"));

        return localProfileActive
                || devtoolsRestartEnabled
                || isLocalEndpoint(datasourceUrl)
                || isLocalEndpoint(minioEndpoint);
    }

    private boolean isLocalEndpoint(String value) {
        String normalized = value == null ? "" : value.toLowerCase();
        return normalized.contains("localhost")
                || normalized.contains("127.0.0.1")
                || normalized.contains("0.0.0.0");
    }

    private String generateRandomSecret() {
        byte[] secretBytes = new byte[48];
        new SecureRandom().nextBytes(secretBytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(secretBytes);
    }
}
