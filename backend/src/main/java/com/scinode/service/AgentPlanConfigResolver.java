package com.scinode.service;

import com.scinode.engine.model.WorkflowNode;
import com.scinode.entity.LLMGlobalConfig;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.Locale;
import java.util.Map;
import java.util.function.Function;

/** 为科研节点组合连接信息与能力模型，保留已有配置字段和选择规则。 */
@Service
public class AgentPlanConfigResolver {
    public static final String DEFAULT_EMBEDDING_MODEL = "doubao-embedding-vision";
    private static final String DEFAULT_PROVIDER = "volcengine_agent_plan";

    private final LLMGlobalConfigService configs;

    public AgentPlanConfigResolver(LLMGlobalConfigService configs) {
        this.configs = configs;
    }

    public ResolvedAgentPlanConfig resolve(WorkflowNode node, String capability) {
        RuntimeSource source = new RuntimeSource(selectNodeConfig(node.getData()), node.getData());
        CapabilityModels models = modelsFor(source, capability);
        return source.resolve(models.active(capability), models.embedding(), models.image(), models.video());
    }

    public ResolvedAgentPlanConfig resolveImageConfig(WorkflowNode node) {
        Map<String, Object> fields = node.getData();
        LLMGlobalConfig selected = findConfig(fields.get("configId"));
        if (selected == null) {
            selected = imageDefault(providerKey(nodeText(fields, "provider")));
        }

        RuntimeSource source = new RuntimeSource(selected, fields);
        String language = firstText(source.node("model"), source.saved(LLMGlobalConfig::getModel));
        String image = firstText(source.node("model"), source.saved(LLMGlobalConfig::getImageModel), language);
        // 图片入口的附属模型沿用配置原值，不套用通用入口的向量默认值。
        return source.resolve(image, source.saved(LLMGlobalConfig::getEmbeddingModel),
                image, source.saved(LLMGlobalConfig::getVideoModel));
    }

    public ResolvedAgentPlanConfig resolveKnowledgeConfig(Long configId, String modelOverride) {
        LLMGlobalConfig selected = configId == null ? null : configs.getById(configId);
        RuntimeSource source = new RuntimeSource(selected, Map.of());
        String embedding = firstText(modelOverride, source.saved(LLMGlobalConfig::getEmbeddingModel),
                DEFAULT_EMBEDDING_MODEL);
        // 知识库保留请求中的配置 ID 和已保存的原始连接字段，供索引与检索共用。
        return new ResolvedAgentPlanConfig(configId,
                providerKey(firstText(source.saved(LLMGlobalConfig::getProvider), DEFAULT_PROVIDER)),
                source.saved(LLMGlobalConfig::getApiUrl), source.saved(LLMGlobalConfig::getApiKey),
                embedding, embedding, source.saved(LLMGlobalConfig::getImageModel),
                source.saved(LLMGlobalConfig::getVideoModel), source.memoryEnabled());
    }

    public void validateApiConfig(ResolvedAgentPlanConfig config, String nodeName) {
        if (!StringUtils.hasText(config.apiUrl()) || !StringUtils.hasText(config.apiKey())
                || !StringUtils.hasText(config.model())) {
            throw new IllegalArgumentException(nodeName + " 节点缺少有效的 Agent Plan 配置，请选择全局配置或填写 API 信息");
        }
    }

    private LLMGlobalConfig selectNodeConfig(Map<String, Object> fields) {
        LLMGlobalConfig selected = findConfig(fields.get("configId"));
        LLMGlobalConfig explicit = findConfig(fields.get("agentPlanConfigId"));
        if (explicit != null) return explicit;
        if (selected != null) return selected;
        return configs.getDefaultConfig(DEFAULT_PROVIDER);
    }

    private LLMGlobalConfig findConfig(Object value) {
        Long id = configId(value);
        return id == null ? null : configs.getById(id);
    }

    private LLMGlobalConfig imageDefault(String provider) {
        if (StringUtils.hasText(provider)) {
            LLMGlobalConfig selected = configs.getDefaultConfig(provider);
            if (selected != null) return selected;
        }
        LLMGlobalConfig selected = configs.getDefaultConfig(DEFAULT_PROVIDER);
        return selected != null ? selected : configs.getDefaultConfig("step");
    }

    private CapabilityModels modelsFor(RuntimeSource source, String capability) {
        String override = source.node("model");
        String language = firstText(override, source.saved(LLMGlobalConfig::getModel));
        String embedding = firstText("embedding".equals(capability) ? override : null,
                source.saved(LLMGlobalConfig::getEmbeddingModel), DEFAULT_EMBEDDING_MODEL);
        String image = firstText("image".equals(capability) ? override : null,
                source.saved(LLMGlobalConfig::getImageModel), language);
        String video = firstText("video".equals(capability) ? override : null,
                source.saved(LLMGlobalConfig::getVideoModel), language);
        return new CapabilityModels(language, embedding, image, video);
    }

    private record CapabilityModels(String language, String embedding, String image, String video) {
        String active(String capability) {
            return switch (capability) {
                case "embedding", "memory", "knowledge" -> embedding;
                case "image" -> image;
                case "video" -> video;
                default -> language;
            };
        }
    }

    private record RuntimeSource(LLMGlobalConfig config, Map<String, Object> fields) {
        String saved(Function<LLMGlobalConfig, String> field) {
            return config == null ? null : field.apply(config);
        }

        String node(String key) {
            return nodeText(fields, key);
        }

        boolean memoryEnabled() {
            return config != null && Integer.valueOf(1).equals(config.getMemoryEnabled());
        }

        ResolvedAgentPlanConfig resolve(String model, String embedding, String image, String video) {
            // 连接优先使用已保存配置，缺失字段再取节点值；模型覆盖单独处理。
            return new ResolvedAgentPlanConfig(config == null ? null : config.getId(),
                    providerKey(firstText(saved(LLMGlobalConfig::getProvider), node("provider"), DEFAULT_PROVIDER)),
                    firstText(saved(LLMGlobalConfig::getApiUrl), node("apiUrl")),
                    firstText(saved(LLMGlobalConfig::getApiKey), node("apiKey")),
                    model, embedding, image, video, memoryEnabled());
        }
    }

    private static Long configId(Object value) {
        if (value instanceof Number number) return number.longValue();
        if (value instanceof String text && StringUtils.hasText(text)) return Long.parseLong(text);
        return null;
    }

    private static String nodeText(Map<String, Object> fields, String key) {
        Object value = fields.get(key);
        return value == null ? null : firstText(String.valueOf(value));
    }

    private static String firstText(String... values) {
        for (String value : values) {
            if (StringUtils.hasText(value)) return value.trim();
        }
        return null;
    }

    private static String providerKey(String value) {
        if (value == null) return null;
        String key = value.trim().toLowerCase(Locale.ROOT);
        return switch (key) {
            case "volcengine", "ark", "agent_plan", "agent plan", "火山方舟" -> DEFAULT_PROVIDER;
            case "open ai" -> "openai";
            case "deep seek" -> "deepseek";
            case "通义千问" -> "qwen";
            case "stepfun", "阶跃星辰" -> "step";
            case "智谱" -> "zhipu";
            case "ai ping" -> "ai_ping";
            case "agnes", "agnes ai" -> "agnes";
            default -> key;
        };
    }
}
