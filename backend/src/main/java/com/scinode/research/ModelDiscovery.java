package com.scinode.research;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.scinode.entity.LLMGlobalConfig;
import com.scinode.service.LLMGlobalConfigService;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;

/** Reads and briefly caches the model inventory exposed by a saved OpenAI-compatible endpoint. */
@Service
public class ModelDiscovery {
    private static final Duration CACHE_TTL = Duration.ofSeconds(60);
    private final LLMGlobalConfigService configs;
    private final Map<Long, CachedInventory> inventoryCache = new ConcurrentHashMap<>();

    public ModelDiscovery(LLMGlobalConfigService configs) {
        this.configs = configs;
    }

    /** Existing setup flow: discover from unsaved address and key without returning the key. */
    public JSONObject discover(JSONObject body) throws Exception {
        String raw = body.getString("apiUrl"), key = body.getString("apiKey");
        Inventory inventory = fetch(raw, key);
        return new JSONObject(Map.of("models", inventory.models(), "endpoint", inventory.endpoint(),
                "fetchedAt", inventory.fetchedAt().toString()));
    }

    public JSONObject inventory(Long configId, boolean refresh) throws Exception {
        LLMGlobalConfig config = requireConfig(configId);
        String fingerprint = fingerprint(config);
        CachedInventory cached = inventoryCache.get(configId);
        if (!refresh && cached != null && fingerprint.equals(cached.fingerprint()) && Instant.now().isBefore(cached.expiresAt())) {
            return inventoryResponse(config, cached.inventory());
        }
        Inventory current = fetch(config.getApiUrl(), config.getApiKey());
        inventoryCache.put(configId, new CachedInventory(current, Instant.now().plus(CACHE_TTL), fingerprint));
        return inventoryResponse(config, current);
    }

    /** Returns only a still-valid cache entry; this method never contacts a model endpoint. */
    public List<String> knownModels(Long configId) {
        if (configId == null) return List.of();
        LLMGlobalConfig config = configs.getById(configId);
        CachedInventory cached = inventoryCache.get(configId);
        return config != null && cached != null && fingerprint(config).equals(cached.fingerprint()) && Instant.now().isBefore(cached.expiresAt())
                ? cached.inventory().models() : List.of();
    }

    /** Checks a selected model against the exact IDs returned by this endpoint's /v1/models. */
    public void validateSelection(Long configId, String model) {
        LLMGlobalConfig config = requireConfig(configId);
        String selected = model == null || model.isBlank() ? config.getModel() : model.trim();
        if (selected == null || selected.isBlank()) throw new IllegalArgumentException("请为模型配置选择默认模型");
        try {
            List<String> actual = inventory(configId, false).getJSONArray("models").toJavaList(String.class);
            if (!actual.contains(selected)) throw new IllegalArgumentException("所选模型不属于此端口的实际模型列表，请刷新模型列表后重新选择");
        } catch (IllegalArgumentException error) {
            throw error;
        } catch (Exception error) {
            String detail = Objects.toString(error.getMessage(), error.getClass().getSimpleName());
            throw new IllegalArgumentException("读取模型端口库存失败：" + detail, error);
        }
    }

    private JSONObject inventoryResponse(LLMGlobalConfig config, Inventory inventory) {
        JSONObject result = new JSONObject();
        result.put("configId", config.getId());
        result.put("configName", config.getConfigName());
        result.put("models", new JSONArray(inventory.models()));
        result.put("fetchedAt", inventory.fetchedAt().toString());
        return result;
    }

    private LLMGlobalConfig requireConfig(Long configId) {
        if (configId == null) throw new IllegalArgumentException("请选择模型配置");
        LLMGlobalConfig config = configs.getById(configId);
        if (config == null || blank(config.getApiUrl()) || blank(config.getApiKey())) {
            throw new IllegalArgumentException("模型配置不存在或缺少端口地址与密钥");
        }
        return config;
    }

    private Inventory fetch(String raw, String key) throws Exception {
        if (blank(raw)) throw new IllegalArgumentException("请先填写 API 地址");
        if (blank(key)) throw new IllegalArgumentException("请先填写 API 密钥");
        String base = raw.trim().replaceAll("/+$", "").replaceAll("/(chat/completions|responses|models)$", "");
        URI endpoint = URI.create(base + (base.endsWith("/v1") ? "/models" : "/v1/models"));
        if (!Set.of("http", "https").contains(endpoint.getScheme()) || endpoint.getHost() == null || endpoint.getUserInfo() != null || endpoint.getQuery() != null || endpoint.getFragment() != null) {
            throw new IllegalArgumentException("请填写有效的 HTTP 或 HTTPS 服务地址");
        }
        try {
            HttpRequest request = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(20))
                    .header("Authorization", "Bearer " + key).header("Accept", "application/json").GET().build();
            HttpResponse<String> response = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8))
                    .followRedirects(HttpClient.Redirect.NEVER).build().send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) throw new IllegalArgumentException("模型列表请求失败：HTTP " + response.statusCode() + "；请检查端口、地址与密钥");
            JSONObject json = JSON.parseObject(response.body());
            JSONArray data = json == null ? null : json.getJSONArray("data");
            if (data == null) throw new IllegalArgumentException("模型列表响应缺少 data 数组；当前接口需支持 OpenAI /v1/models");
            TreeSet<String> ids = new TreeSet<>();
            for (int i = 0; i < data.size(); i++) {
                JSONObject item = data.getJSONObject(i);
                String id = item == null ? null : item.getString("id");
                if (!blank(id)) ids.add(id);
            }
            if (ids.isEmpty()) throw new IllegalArgumentException("服务返回了空模型列表，请检查网关的模型配置");
            return new Inventory(List.copyOf(ids), endpoint.toString(), Instant.now());
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("模型列表请求已中断");
        } catch (Exception error) {
            String detail = Objects.toString(error.getMessage(), error.getClass().getSimpleName()).replace(key, "[密钥隐藏]");
            if (error instanceof IllegalArgumentException argument) throw new IllegalArgumentException(detail, argument);
            throw new IllegalArgumentException(detail, error);
        }
    }

    private static boolean blank(String value) { return value == null || value.isBlank(); }
    private String fingerprint(LLMGlobalConfig config) {
        String value = Objects.toString(config.getApiUrl(), "") + "\u0000" + Objects.toString(config.getApiKey(), "");
        return ResearchStore.hash(value.getBytes(StandardCharsets.UTF_8));
    }
    private record Inventory(List<String> models, String endpoint, Instant fetchedAt) { }
    private record CachedInventory(Inventory inventory, Instant expiresAt, String fingerprint) { }
}
