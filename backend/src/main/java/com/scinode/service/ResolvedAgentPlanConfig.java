package com.scinode.service;

/**
 * Runtime API configuration resolved from a workflow node and optional global config.
 */
public record ResolvedAgentPlanConfig(
        Long configId,
        String provider,
        String apiUrl,
        String apiKey,
        String model,
        String embeddingModel,
        String imageModel,
        String videoModel,
        boolean memoryEnabled
) {
}
