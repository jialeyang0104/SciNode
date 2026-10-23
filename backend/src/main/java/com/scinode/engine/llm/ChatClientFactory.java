package com.scinode.engine.llm;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.model.function.FunctionCallback;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.api.OpenAiApi;
import org.springframework.ai.retry.RetryUtils;
import org.springframework.http.MediaType;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * ChatClient动态工厂
 * 根据节点配置在运行时创建不同类型的ChatClient实例
 */
@Slf4j
@Component
public class ChatClientFactory {

    private static final String CHAT_COMPLETIONS_SUFFIX = "/v1/chat/completions";

    private static final String V1_SUFFIX = "/v1";

    /**
     * 根据提供商和配置创建ChatClient
     *
     * @param provider    提供商标识 (openai/deepseek/qwen/step/zhipu/ai_ping/apifree)
     * @param apiUrl      API端点URL
     * @param apiKey      API密钥
     * @param model       模型名称
     * @param temperature 温度参数
     * @return ChatClient实例
     */
    public ChatClient createClient(String provider, String apiUrl, String apiKey,
                                   String model, Double temperature) {
        return createClientWithFunctions(provider, apiUrl, apiKey, model, temperature, List.of());
    }

    /** Streams assistant text through the same OpenAI-compatible Chat Completions contract,
     * with the reasoning_effort JSON field explicitly present in the request body. */
    public Flux<String> streamAssistantCompletion(String provider, String apiUrl, String apiKey,
                                                   String model, List<Message> messages, String reasoningEffort) {
        String normalizedProvider = normalizeProvider(provider);
        String normalizedModel = normalizeModel(normalizedProvider, model);
        String endpoint = "volcengine_agent_plan".equals(normalizedProvider)
                ? normalizeAgentPlanBaseUrl(apiUrl) + "/api/plan/v3/chat/completions"
                : normalizeBaseUrl(apiUrl) + CHAT_COMPLETIONS_SUFFIX;
        List<Map<String, String>> turns = messages.stream().map(message -> Map.of(
                "role", message.getMessageType().getValue(), "content", message.getText())).toList();
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("model", normalizedModel);
        request.put("messages", turns);
        request.put("stream", true);
        if (reasoningEffort != null) request.put("reasoning_effort", reasoningEffort);

        WebClient client = WebClient.builder().build();
        return client.post().uri(endpoint)
                .headers(headers -> {
                    headers.setContentType(MediaType.APPLICATION_JSON);
                    if (apiKey != null && !apiKey.isBlank()) headers.setBearerAuth(apiKey);
                    headers.setAccept(List.of(MediaType.TEXT_EVENT_STREAM, MediaType.APPLICATION_JSON, MediaType.TEXT_PLAIN));
                })
                .bodyValue(request)
                .exchangeToFlux(response -> {
                    if (!response.statusCode().is2xxSuccessful()) {
                        return response.bodyToMono(String.class).defaultIfEmpty("").flatMapMany(body -> Flux.error(
                                reasoningEffortError(response.statusCode().value(), body)));
                    }
                    MediaType contentType = response.headers().contentType().orElse(MediaType.APPLICATION_JSON);
                    if (MediaType.TEXT_EVENT_STREAM.isCompatibleWith(contentType)) {
                        return response.bodyToFlux(new ParameterizedTypeReference<ServerSentEvent<String>>() { })
                                .mapNotNull(ServerSentEvent::data)
                                .flatMapIterable(ChatClientFactory::responseDeltas);
                    }
                    if (MediaType.APPLICATION_JSON.isCompatibleWith(contentType)
                            || MediaType.TEXT_PLAIN.isCompatibleWith(contentType)) {
                        return response.bodyToMono(String.class).flatMapMany(body -> Flux.fromIterable(responseDeltas(body)));
                    }
                    return response.releaseBody().thenMany(Flux.error(new IllegalStateException(
                            "所选思考等级需要模型接口返回 OpenAI 兼容的 JSON 或 SSE 流式响应；请改用默认等级或切换服务接口")));
                });
    }

    private static IllegalStateException reasoningEffortError(int status, String body) {
        String detail = body == null ? "" : body.strip();
        String normalized = detail.toLowerCase(Locale.ROOT);
        boolean namesEffort = normalized.contains("reasoning_effort") || normalized.contains("reasoning effort");
        boolean rejectsEffort = normalized.matches("(?s).*(unknown|unsupported|not supported|unrecognized|invalid|not allowed|does not support|not enabled).*" );
        if (namesEffort && rejectsEffort) {
            return new IllegalStateException("所选模型服务没有接受本次带思考等级的请求（HTTP " + status
                    + "）。请确认服务支持 OpenAI Chat Completions 的 reasoning_effort 参数；否则将思考等级改回“默认”后重试，或切换兼容模型。服务详情：" + detail);
        }
        if (status == 400 || status == 422) {
            return new IllegalStateException("模型服务拒绝了带思考等级的请求（HTTP " + status
                    + "）。请检查服务返回详情；也可以改回“默认”重试，或切换兼容模型。服务详情：" + detail);
        }
        return new IllegalStateException("模型接口返回 HTTP " + status + ": " + detail);
    }

    static List<String> responseDeltas(String raw) {
        if (raw == null || raw.isBlank()) return List.of();
        List<String> result = new ArrayList<>();
        String body = raw.strip();
        if (body.startsWith("{")) {
            JSONObject parsed = null;
            try {
                parsed = JSON.parseObject(body);
            } catch (RuntimeException ignored) {
                // A streaming body is parsed event-by-event below.
            }
            if (parsed != null) {
                collectResponseDeltas(parsed, result);
                return result;
            }
        }
        StringBuilder eventData = new StringBuilder();
        for (String line : raw.split("\\R")) {
            String value = line.strip();
            if (value.isBlank()) {
                collectEventData(eventData, result);
                eventData.setLength(0);
            } else if (value.startsWith("data:")) {
                if (!eventData.isEmpty()) eventData.append('\n');
                eventData.append(value.substring(5).strip());
            }
        }
        collectEventData(eventData, result);
        return result;
    }

    private static void collectEventData(StringBuilder eventData, List<String> result) {
        String data = eventData.toString().strip();
        if (data.isEmpty() || "[DONE]".equals(data)) return;
        JSONObject parsed;
        try { parsed = JSON.parseObject(data); }
        catch (RuntimeException ignored) { return; /* Ignore non-JSON SSE control frames. */ }
        collectResponseDeltas(parsed, result);
    }

    private static void collectResponseDeltas(JSONObject event, List<String> result) {
        if (event == null) return;
        if (event.containsKey("error") && event.get("error") != null) {
            Object rawError = event.get("error");
            String detail = rawError instanceof JSONObject error
                    ? error.getString("message") : String.valueOf(rawError);
            if (detail == null || detail.isBlank()) detail = rawError.toString();
            throw new IllegalStateException("模型服务返回错误：" + detail);
        }
        JSONArray choices = event.getJSONArray("choices");
        if (choices == null) return;
        for (Object rawChoice : choices) {
            if (!(rawChoice instanceof JSONObject choice)) continue;
            JSONObject delta = choice.getJSONObject("delta");
            JSONObject message = choice.getJSONObject("message");
            Object content = delta != null ? delta.get("content") : message == null ? null : message.get("content");
            if (content instanceof String text && !text.isEmpty()) result.add(text);
        }
    }

    /**
     * 创建带 Function Calling 支持的 ChatClient
     *
     * @param provider    提供商标识 (openai/deepseek/qwen/step/zhipu/ai_ping/apifree)
     * @param apiUrl      API端点URL
     * @param apiKey      API密钥
     * @param model       模型名称
     * @param temperature 温度参数
     * @param functions   函数回调列表
     * @return ChatClient实例
     */
    public ChatClient createClientWithFunctions(String provider, String apiUrl, String apiKey,
                                                 String model, Double temperature,
                                                 List<FunctionCallback> functions) {
        String normalizedProvider = normalizeProvider(provider);
        String normalizedModel = normalizeModel(normalizedProvider, model);
        if (!normalizedModel.equals(model)) {
            log.warn("检测到 {} 模型别名，已自动归一化: {} -> {}", normalizedProvider, model, normalizedModel);
        }
        log.info("创建ChatClient - 类型: {}, URL: {}, 模型: {}, 温度: {}, 函数数量: {}",
                normalizedProvider, apiUrl, normalizedModel, temperature, functions.size());

        ChatModel chatModel = switch (normalizedProvider) {
            case "openai", "deepseek", "qwen", "step", "zhipu", "ai_ping", "agnes" ->
                    createOpenAICompatibleModel(apiUrl, apiKey, normalizedModel, temperature);
            case "apifree" ->
                    createApifreeChatModel(apiUrl, apiKey, normalizedModel, temperature);
            case "volcengine_agent_plan" ->
                    createVolcengineArkChatModel(apiUrl, apiKey, normalizedModel, temperature);
            default -> throw new IllegalArgumentException("不支持的提供商类型: " + provider);
        };

        ChatClient.Builder builder = ChatClient.builder(chatModel);

        // 注册函数 - 直接传入 FunctionCallback 实例
        if (functions != null && !functions.isEmpty()) {
            builder.defaultFunctions(functions.toArray(new FunctionCallback[0]));
            for (FunctionCallback function : functions) {
                log.debug("注册函数: {}", function.getName());
            }
        }

        return builder.build();
    }

    /**
     * 创建OpenAI兼容的ChatModel
     * 支持OpenAI、DeepSeek和通义千问（通过OpenAI兼容接口）
     */
    private ChatModel createOpenAICompatibleModel(String apiUrl, String apiKey,
                                                   String model, Double temperature) {
        String normalizedApiUrl = normalizeBaseUrl(apiUrl);
        if (!normalizedApiUrl.equals(apiUrl)) {
            log.warn("检测到 OpenAI 兼容接口地址包含路径后缀，已自动归一化: {} -> {}", apiUrl, normalizedApiUrl);
        }

        // 使用构造函数创建OpenAiApi（支持自定义baseUrl）
        OpenAiApi openAiApi = new OpenAiApi(normalizedApiUrl, apiKey);

        // 创建ChatModel并配置选项
        OpenAiChatOptions options = OpenAiChatOptions.builder()
                .model(model)
                .temperature(temperature)
                .build();

        return new OpenAiChatModel(openAiApi, options);
    }

    /**
     * APIFree 的 SkyClaw agent endpoint 有时会以 text/plain 返回 OpenAI 兼容 JSON。
     * Spring AI 默认 JSON converter 不接收 text/plain，需要为 APIFree 单独放宽响应类型。
     */
    private ChatModel createApifreeChatModel(String apiUrl, String apiKey,
                                             String model, Double temperature) {
        String normalizedApiUrl = normalizeBaseUrl(apiUrl);
        if (!normalizedApiUrl.equals(apiUrl)) {
            log.warn("检测到 APIFree 兼容接口地址包含路径后缀，已自动归一化: {} -> {}", apiUrl, normalizedApiUrl);
        }

        OpenAiApi openAiApi = new OpenAiApi(
                normalizedApiUrl,
                apiKey,
                createTextPlainJsonRestClientBuilder(),
                WebClient.builder(),
                RetryUtils.DEFAULT_RESPONSE_ERROR_HANDLER
        );

        OpenAiChatOptions options = OpenAiChatOptions.builder()
                .model(model)
                .temperature(temperature)
                .build();

        return new OpenAiChatModel(openAiApi, options);
    }

    /**
     * Agent Plan 的 OpenAI 兼容 Chat 接口路径是 /api/plan/v3/chat/completions。
     * Spring AI 默认会拼 /v1/chat/completions，这里显式覆盖为 Agent Plan 的路径。
     */
    private ChatModel createVolcengineArkChatModel(String apiUrl, String apiKey,
                                                    String model, Double temperature) {
        String baseUrl = normalizeAgentPlanBaseUrl(apiUrl);
        if (!baseUrl.equals(apiUrl)) {
            log.warn("检测到 Agent Plan 配置地址包含接口路径，已自动归一化: {} -> {}{}", apiUrl, baseUrl, "/api/plan/v3/chat/completions");
        }

        OpenAiApi openAiApi = new OpenAiApi(
                baseUrl,
                apiKey,
                "/api/plan/v3/chat/completions",
                "/api/plan/v3/embeddings",
                RestClient.builder(),
                WebClient.builder(),
                RetryUtils.DEFAULT_RESPONSE_ERROR_HANDLER
        );

        OpenAiChatOptions options = OpenAiChatOptions.builder()
                .model(model)
                .temperature(temperature)
                .build();

        return new OpenAiChatModel(openAiApi, options);
    }

    /**
     * Spring AI 的 OpenAiApi 会自行拼接 /v1/chat/completions，
     * 这里统一将用户输入的 URL 归一化为服务根地址，兼容误填完整接口地址的情况。
     */
    private String normalizeBaseUrl(String apiUrl) {
        String normalized = stripTrailingSlash(apiUrl == null ? "" : apiUrl.trim());
        normalized = stripSuffixIgnoreCase(normalized, CHAT_COMPLETIONS_SUFFIX);
        normalized = stripSuffixIgnoreCase(normalized, V1_SUFFIX);
        return stripTrailingSlash(normalized);
    }

    private String normalizeAgentPlanBaseUrl(String apiUrl) {
        String normalized = stripTrailingSlash(apiUrl == null ? "" : apiUrl.trim());
        normalized = stripSuffixIgnoreCase(normalized, "/api/plan/v3/chat/completions");
        normalized = stripSuffixIgnoreCase(normalized, "/api/plan/v3");
        return stripTrailingSlash(normalized);
    }

    private String stripSuffixIgnoreCase(String value, String suffix) {
        String lowerValue = value.toLowerCase(Locale.ROOT);
        if (!lowerValue.endsWith(suffix)) {
            return value;
        }
        return value.substring(0, value.length() - suffix.length());
    }

    private String stripTrailingSlash(String value) {
        int end = value.length();
        while (end > 0 && value.charAt(end - 1) == '/') {
            end--;
        }
        return value.substring(0, end);
    }

    private RestClient.Builder createTextPlainJsonRestClientBuilder() {
        MappingJackson2HttpMessageConverter textPlainJsonConverter = new MappingJackson2HttpMessageConverter();
        textPlainJsonConverter.setSupportedMediaTypes(List.of(
                MediaType.APPLICATION_JSON,
                new MediaType("application", "*+json"),
                MediaType.TEXT_PLAIN
        ));

        return RestClient.builder()
                .messageConverters(converters -> converters.add(0, textPlainJsonConverter));
    }

    private String normalizeProvider(String provider) {
        if (provider == null) {
            return "";
        }

        String normalized = provider.trim().toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "open ai" -> "openai";
            case "deep seek" -> "deepseek";
            case "通义千问" -> "qwen";
            case "stepfun", "阶跃星辰" -> "step";
            case "智谱" -> "zhipu";
            case "ai ping" -> "ai_ping";
            case "agnes ai" -> "agnes";
            case "api free", "apifree.ai", "skyclaw", "skyclaw-v1", "skyclaw-v1.0",
                 "skyclaw-v1-lite", "skyclaw-v1.0-lite", "skywork-ai/skyclaw-v1",
                 "skywork-ai/skyclaw-v1-lite" -> "apifree";
            case "volcengine", "ark", "agent_plan", "agent plan", "火山方舟" -> "volcengine_agent_plan";
            default -> normalized;
        };
    }

    private String normalizeModel(String provider, String model) {
        if (model == null) {
            return "";
        }

        if (!"apifree".equals(provider)) {
            return model;
        }

        String normalized = model.trim().toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "skyclaw", "skyclaw-v1", "skyclaw-v1.0" -> "skywork-ai/skyclaw-v1";
            case "skyclaw-lite", "skyclaw-v1-lite", "skyclaw-v1.0-lite" -> "skywork-ai/skyclaw-v1-lite";
            default -> model.trim();
        };
    }
}
