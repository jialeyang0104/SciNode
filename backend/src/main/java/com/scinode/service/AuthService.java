package com.scinode.service;

import com.scinode.config.JwtSecretProvider;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.beans.factory.annotation.Autowired;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.UUID;

/**
 * 认证服务
 */
@Service
public class AuthService {

    /**
     * 默认用户名（通过环境变量配置，不配置则禁用默认账户）
     */
    @Value("${scinode.default-username:}")
    private String defaultUsername;

    /**
     * 默认密码（通过环境变量配置，不配置则禁用默认账户）
     */
    @Value("${scinode.default-password:}")
    private String defaultPassword;

    private static final String ACCESS_TOKEN_TYPE = "access";
    private static final String REFRESH_TOKEN_PREFIX = "auth:refresh:";

    @Autowired
    private JwtSecretProvider jwtSecretProvider;

    @Value("${scinode.auth.access-token-expiration-minutes:120}")
    private long accessTokenExpirationMinutes;

    @Value("${scinode.auth.refresh-token-expiration-hours:168}")
    private long refreshTokenExpirationHours;

    @Autowired
    private StringRedisTemplate stringRedisTemplate;
    
    /**
     * 用户登录
     */
    public AuthTokens login(String username, String password) {
        // 检查是否配置了默认账户
        if (defaultUsername != null && !defaultUsername.isEmpty()
            && defaultPassword != null && !defaultPassword.isEmpty()) {
            if (defaultUsername.equals(username) && defaultPassword.equals(password)) {
                return issueTokens(username);
            }
        }
        return null;
    }

    public AuthTokens refresh(String refreshToken) {
        String username = getUsernameByRefreshToken(refreshToken);
        if (username == null || !username.equals(defaultUsername)) {
            revokeRefreshToken(refreshToken);
            return null;
        }

        revokeRefreshToken(refreshToken);
        return issueTokens(username);
    }
    
    /**
     * 用户登出
     */
    public void logout(String refreshToken) {
        revokeRefreshToken(refreshToken);
    }
    
    /**
     * 验证 Token
     */
    public boolean validateToken(String token) {
        try {
            Claims claims = parseClaims(token);
            return defaultUsername != null && defaultUsername.equals(claims.getSubject())
                    && ACCESS_TOKEN_TYPE.equals(claims.get("tokenType"))
                    && claims.getExpiration() != null
                    && claims.getExpiration().after(new Date());
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }
    
    /**
     * 获取 Token 对应的用户名
     */
    public String getUsernameByToken(String token) {
        if (!validateToken(token)) return null;
        try {
            Claims claims = parseClaims(token);
            return ACCESS_TOKEN_TYPE.equals(claims.get("tokenType")) ? claims.getSubject() : null;
        } catch (JwtException | IllegalArgumentException e) {
            return null;
        }
    }

    public void revokeRefreshToken(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            return;
        }
        stringRedisTemplate.delete(buildRefreshTokenKey(refreshToken));
    }

    private AuthTokens issueTokens(String username) {
        String accessToken = createAccessToken(username);
        String refreshToken = createRefreshToken();

        stringRedisTemplate.opsForValue().set(
                buildRefreshTokenKey(refreshToken),
                username,
                Duration.ofHours(refreshTokenExpirationHours)
        );

        return new AuthTokens(accessToken, refreshToken, username);
    }

    private String createAccessToken(String username) {
        Instant now = Instant.now();
        Instant expiresAt = now.plus(accessTokenExpirationMinutes, ChronoUnit.MINUTES);

        return Jwts.builder()
                .subject(username)
                .claim("tokenType", ACCESS_TOKEN_TYPE)
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiresAt))
                .signWith(getSigningKey())
                .compact();
    }

    private String createRefreshToken() {
        return UUID.randomUUID().toString().replace("-", "");
    }

    private String getUsernameByRefreshToken(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            return null;
        }
        return stringRedisTemplate.opsForValue().get(buildRefreshTokenKey(refreshToken));
    }

    private String buildRefreshTokenKey(String refreshToken) {
        return REFRESH_TOKEN_PREFIX + refreshToken;
    }

    private Claims parseClaims(String token) {
        return Jwts.parser()
                .verifyWith(getSigningKey())
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    private SecretKey getSigningKey() {
        return Keys.hmacShaKeyFor(jwtSecretProvider.getSecret().getBytes(StandardCharsets.UTF_8));
    }

    public record AuthTokens(String accessToken, String refreshToken, String username) {
    }
}
