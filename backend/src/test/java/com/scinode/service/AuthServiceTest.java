package com.scinode.service;

import com.scinode.config.JwtSecretProvider;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class AuthServiceTest {

    private static final String JWT_SECRET = "test-jwt-secret-key-for-auth-service-123456";
    private static final String DEFAULT_USERNAME = "admin";
    private static final String DEFAULT_PASSWORD = "admin123";

    @Test
    void shouldGenerateAndValidateJwtToken() {
        AuthService authService = createAuthService(new HashMap<>());

        AuthService.AuthTokens tokens = authService.login(DEFAULT_USERNAME, DEFAULT_PASSWORD);

        assertNotNull(tokens);
        assertNotNull(tokens.accessToken());
        assertNotNull(tokens.refreshToken());
        assertTrue(authService.validateToken(tokens.accessToken()));
        assertEquals(DEFAULT_USERNAME, authService.getUsernameByToken(tokens.accessToken()));
    }

    @Test
    void shouldRefreshAcrossServiceInstances() {
        Map<String, String> redisStore = new HashMap<>();
        AuthService issuer = createAuthService(redisStore);
        AuthService validator = createAuthService(redisStore);

        AuthService.AuthTokens issued = issuer.login(DEFAULT_USERNAME, DEFAULT_PASSWORD);
        AuthService.AuthTokens refreshed = validator.refresh(issued.refreshToken());

        assertNotNull(issued);
        assertNotNull(refreshed);
        assertTrue(validator.validateToken(refreshed.accessToken()));
        assertEquals(DEFAULT_USERNAME, validator.getUsernameByToken(refreshed.accessToken()));
        assertNull(validator.refresh(issued.refreshToken()));
    }

    @Test
    void usernameChangePreservesNewLoginAndRevokesOldSessions() {
        AuthService service=createAuthService(new HashMap<>());
        AuthService.AuthTokens old=service.login(DEFAULT_USERNAME,DEFAULT_PASSWORD);
        ReflectionTestUtils.setField(service,"defaultUsername","renamed-account");
        ReflectionTestUtils.setField(service,"defaultPassword","new-test-password");
        assertFalse(service.validateToken(old.accessToken()));
        assertNull(service.getUsernameByToken(old.accessToken()));
        assertNull(service.refresh(old.refreshToken()));
        assertNull(service.login(DEFAULT_USERNAME,DEFAULT_PASSWORD));
        AuthService.AuthTokens current=service.login("renamed-account","new-test-password");
        assertNotNull(current);assertTrue(service.validateToken(current.accessToken()));
    }

    @Test
    void shouldRejectWrongCredentials() {
        AuthService authService = createAuthService(new HashMap<>());

        assertNull(authService.login(DEFAULT_USERNAME, "wrong-password"));
    }

    private AuthService createAuthService(Map<String, String> redisStore) {
        AuthService authService = new AuthService();
        JwtSecretProvider jwtSecretProvider = mock(JwtSecretProvider.class);
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> valueOperations = mock(ValueOperations.class);

        when(jwtSecretProvider.getSecret()).thenReturn(JWT_SECRET);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        doAnswer(invocation -> {
            redisStore.put(invocation.getArgument(0), invocation.getArgument(1));
            return null;
        }).when(valueOperations).set(anyString(), anyString(), any(Duration.class));
        when(valueOperations.get(anyString())).thenAnswer(invocation -> redisStore.get(invocation.getArgument(0)));
        when(redisTemplate.delete(anyString())).thenAnswer(invocation -> redisStore.remove(invocation.getArgument(0)) != null);

        ReflectionTestUtils.setField(authService, "jwtSecretProvider", jwtSecretProvider);
        ReflectionTestUtils.setField(authService, "accessTokenExpirationMinutes", 120L);
        ReflectionTestUtils.setField(authService, "refreshTokenExpirationHours", 168L);
        ReflectionTestUtils.setField(authService, "defaultUsername", DEFAULT_USERNAME);
        ReflectionTestUtils.setField(authService, "defaultPassword", DEFAULT_PASSWORD);
        ReflectionTestUtils.setField(authService, "stringRedisTemplate", redisTemplate);
        return authService;
    }
}
