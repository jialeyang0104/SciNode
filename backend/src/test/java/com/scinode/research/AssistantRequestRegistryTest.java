package com.scinode.research;

import org.junit.jupiter.api.Test;

import java.util.UUID;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.FutureTask;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AssistantRequestRegistryTest {

    @Test
    void cancelsTheModelTaskAndItsUpstreamStream() {
        AssistantRequestRegistry registry = new AssistantRequestRegistry();
        UUID id = UUID.randomUUID();
        AssistantRequestRegistry.Entry entry = registry.begin("alice", id);
        FutureTask<Void> task = new FutureTask<>(() -> null);
        CompletableFuture<String> stream = new CompletableFuture<>();
        entry.setTask(task);
        entry.setStream(stream);

        assertEquals(AssistantRequestRegistry.CancelStatus.CANCELED, registry.cancel("alice", id));
        assertTrue(task.isCancelled());
        assertTrue(stream.isCancelled());
        assertThrows(CancellationException.class, () -> entry.checkCanceled());
    }

    @Test
    void cancellationBeforeRegistrationIsRememberedAndScopedToUser() {
        AssistantRequestRegistry registry = new AssistantRequestRegistry();
        UUID id = UUID.randomUUID();

        assertEquals(AssistantRequestRegistry.CancelStatus.CANCELED, registry.cancel("alice", id));
        assertThrows(CancellationException.class, () -> registry.begin("alice", id));
        AssistantRequestRegistry.Entry otherUser = registry.begin("bob", id);
        otherUser.checkCanceled();
        assertEquals(AssistantRequestRegistry.CancelStatus.CANCELED, registry.cancel("alice", id));
    }

    @Test
    void expiresTerminalEntriesAndKeepsRegistryBounded() {
        AtomicLong clock = new AtomicLong(100);
        AssistantRequestRegistry registry = new AssistantRequestRegistry(2, 10, clock::get);
        UUID firstId = UUID.randomUUID();
        AssistantRequestRegistry.Entry first = registry.begin("alice", firstId);
        registry.finish(first);
        AssistantRequestRegistry.Entry second = registry.begin("bob", UUID.randomUUID());

        assertEquals(2, registry.size());
        registry.finish(second);
        clock.addAndGet(11);
        assertEquals(0, registry.size());
        registry.begin("alice", firstId);
        registry.begin("bob", UUID.randomUUID());
        assertThrows(IllegalStateException.class, () -> registry.begin("carol", UUID.randomUUID()));
        assertEquals(2, registry.size());
    }

    @Test
    void duplicateActiveRequestIdsAreRejected() {
        AssistantRequestRegistry registry = new AssistantRequestRegistry();
        UUID id = UUID.randomUUID();
        registry.begin("alice", id);

        IllegalStateException error = assertThrows(IllegalStateException.class, () -> registry.begin("alice", id));
        assertTrue(error.getMessage().contains("requestId"));
    }

    @Test
    void exposesOnlyUserScopedPhasesAndExpiresFailedTerminalEntries() {
        AtomicLong clock = new AtomicLong(100);
        AssistantRequestRegistry registry = new AssistantRequestRegistry(2, 10, clock::get);
        UUID id = UUID.randomUUID();
        AssistantRequestRegistry.Entry entry = registry.begin("alice", id);

        assertEquals("PREPARING", registry.phase("alice", id));
        assertEquals("NOT_FOUND", registry.phase("bob", id));
        entry.setPhase(AssistantRequestRegistry.Phase.GENERATING);
        assertEquals("GENERATING", registry.phase("alice", id));
        registry.fail(entry);
        assertEquals("FAILED", registry.phase("alice", id));

        clock.addAndGet(11);
        assertEquals("NOT_FOUND", registry.phase("alice", id));
    }
}
