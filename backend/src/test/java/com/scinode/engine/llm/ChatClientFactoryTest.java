package com.scinode.engine.llm;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.UserMessage;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.lang.reflect.Method;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ChatClientFactoryTest {

    private final ChatClientFactory factory = new ChatClientFactory();

    @Test
    void createClient_acceptsSkyClawProviderAliasAsOpenAiCompatible() {
        ChatClient client = assertDoesNotThrow(() ->
                factory.createClient(
                        "skyclaw-v1.0",
                        "https://api.apifree.ai/agent/v1/chat/completions",
                        "test-api-key",
                        "skywork-ai/skyclaw-v1",
                        0.7
                )
        );

        assertNotNull(client);
    }

    @Test
    void normalizeModel_mapsSkyClawProductNamesToApifreeModelIds() throws Exception {
        Method normalizeModel = ChatClientFactory.class.getDeclaredMethod("normalizeModel", String.class, String.class);
        normalizeModel.setAccessible(true);

        assertEquals("skywork-ai/skyclaw-v1",
                normalizeModel.invoke(factory, "apifree", "skyclaw-v1.0"));
        assertEquals("skywork-ai/skyclaw-v1-lite",
                normalizeModel.invoke(factory, "apifree", "skyclaw-v1.0-lite"));
    }

    @Test
    void apifreeClient_parsesOpenAiJsonReturnedAsTextPlain() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            byte[] response = """
                    {
                      "id": "chatcmpl-test",
                      "object": "chat.completion",
                      "created": 1779881763,
                      "model": "skywork-ai/skyclaw-v1",
                      "choices": [
                        {
                          "index": 0,
                          "message": {
                            "role": "assistant",
                            "content": "pong"
                          },
                          "finish_reason": "stop"
                        }
                      ]
                    }
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "text/plain;charset=utf-8");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        try {
            ChatClient client = factory.createClient(
                    "apifree",
                    "http://localhost:" + server.getAddress().getPort(),
                    "test-api-key",
                    "skywork-ai/skyclaw-v1",
                    0.7
            );

            String content = client.prompt().user("ping").call().chatResponse()
                    .getResult().getOutput().getContent();

            assertEquals("pong", content);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void reasoningEffortRequestCarriesLowMediumHighAndOmitsDefault() throws Exception {
        AtomicReference<String> requestBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = """
                    {
                      "id": "chatcmpl-test",
                      "model": "reasoning-model",
                      "choices": [
                        {"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}
                      ],
                      "reasoning_content": "private reasoning must not be returned"
                    }
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        try {
            String endpoint = "http://localhost:" + server.getAddress().getPort();
            for (String effort : new String[]{"low", "medium", "high", null}) {
                List<String> content = factory.streamAssistantCompletion("openai", endpoint, "test-key",
                                "reasoning-model", List.of(new UserMessage("ping")), effort)
                        .collectList().block(Duration.ofSeconds(5));
                assertEquals(List.of("ok"), content);
                JSONObject sent = JSON.parseObject(requestBody.get());
                assertEquals("reasoning-model", sent.getString("model"));
                assertTrue(sent.getBooleanValue("stream"));
                if (effort == null) assertFalse(sent.containsKey("reasoning_effort"));
                else assertEquals(effort, sent.getString("reasoning_effort"));
            }
        } finally {
            server.stop(0);
        }
    }

    @Test
    void defaultSpringAiChatRequestOmitsReasoningEffort() throws Exception {
        AtomicReference<String> requestBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = """
                    {"id":"chatcmpl-test","model":"default-model","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}]}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        try {
            ChatClient client = factory.createClient("openai", "http://localhost:" + server.getAddress().getPort(),
                    "test-api-key", "default-model", 0.2);
            String content = client.prompt().user("ping").call().chatResponse()
                    .getResult().getOutput().getContent();

            assertEquals("pong", content);
            assertFalse(JSON.parseObject(requestBody.get()).containsKey("reasoning_effort"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void unsupportedReasoningEffortHasActionableCompatibilityError() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            byte[] response = "{\"error\":{\"message\":\"unsupported reasoning_effort\"}}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(400, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        try {
            RuntimeException error = assertThrows(RuntimeException.class, () -> factory.streamAssistantCompletion(
                    "openai", "http://localhost:" + server.getAddress().getPort(), "test-key", "reasoning-model",
                    List.of(new UserMessage("ping")), "high").collectList().block(Duration.ofSeconds(5)));
            String details = messages(error);
            assertTrue(details.contains("reasoning_effort"));
            assertTrue(details.contains("默认"));
            assertTrue(details.contains("兼容模型"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void streamingServiceErrorIsNotSilentlyTreatedAsEmptyAssistantText() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            byte[] response = "data: {\"error\":{\"message\":\"quota exhausted\"}}\n\n".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "text/event-stream");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        try {
            RuntimeException error = assertThrows(RuntimeException.class, () -> factory.streamAssistantCompletion(
                    "openai", "http://localhost:" + server.getAddress().getPort(), "test-key", "reasoning-model",
                    List.of(new UserMessage("ping")), "high").collectList().block(Duration.ofSeconds(5)));
            assertTrue(messages(error).contains("quota exhausted"));
        } finally {
            server.stop(0);
        }
    }

    private static String messages(Throwable error) {
        StringBuilder result = new StringBuilder();
        for (Throwable current = error; current != null; current = current.getCause()) {
            if (current.getMessage() != null) result.append(current.getMessage()).append('\n');
        }
        return result.toString();
    }
}
