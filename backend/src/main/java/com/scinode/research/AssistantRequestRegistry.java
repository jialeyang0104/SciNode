package com.scinode.research;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Future;
import java.util.concurrent.CancellationException;
import java.util.function.LongSupplier;

/** Keeps assistant request IDs scoped to their authenticated user and bounds cancellation tombstones. */
final class AssistantRequestRegistry {
    static final int DEFAULT_MAX_ENTRIES = 1_024;
    static final long DEFAULT_TTL_NANOS = 10 * 60 * 1_000_000_000L;

    private final int maxEntries;
    private final long ttlNanos;
    private final LongSupplier clock;
    private final LinkedHashMap<Key, Entry> entries = new LinkedHashMap<>();

    AssistantRequestRegistry() {
        this(DEFAULT_MAX_ENTRIES, DEFAULT_TTL_NANOS, System::nanoTime);
    }

    AssistantRequestRegistry(int maxEntries, long ttlNanos, LongSupplier clock) {
        if (maxEntries < 1 || ttlNanos < 1) throw new IllegalArgumentException("Registry bounds must be positive");
        this.maxEntries = maxEntries;
        this.ttlNanos = ttlNanos;
        this.clock = clock;
    }

    synchronized Entry begin(String user, UUID requestId) {
        Key key = new Key(user, requestId);
        long now = clock.getAsLong();
        prune(now);
        Entry previous = entries.get(key);
        if (previous != null) {
            if (previous.isCanceled()) throw new CancellationException("助手请求已取消");
            throw new IllegalStateException("requestId 已被使用，请为新请求生成新的 UUID");
        }
        ensureCapacity();
        Entry entry = new Entry(now, ttlNanos);
        entries.put(key, entry);
        return entry;
    }

    synchronized CancelStatus cancel(String user, UUID requestId) {
        long now = clock.getAsLong();
        prune(now);
        Key key = new Key(user, requestId);
        Entry entry = entries.get(key);
        if (entry == null) {
            ensureCapacity();
            entry = new Entry(now, ttlNanos);
            entries.put(key, entry);
            entry.cancel(now);
            return CancelStatus.CANCELED;
        }
        return entry.cancel(now);
    }

    synchronized boolean finish(Entry entry) { return entry.complete(clock.getAsLong()); }

    synchronized void fail(Entry entry) { entry.fail(clock.getAsLong()); }

    synchronized String phase(String user, UUID requestId) {
        prune(clock.getAsLong());
        Entry entry = entries.get(new Key(user, requestId));
        return entry == null ? Phase.NOT_FOUND.name() : entry.phase().name();
    }

    synchronized int size() {
        prune(clock.getAsLong());
        return entries.size();
    }

    private void prune(long now) {
        Iterator<Map.Entry<Key, Entry>> iterator = entries.entrySet().iterator();
        while (iterator.hasNext()) if (iterator.next().getValue().expired(now)) iterator.remove();
    }

    private void ensureCapacity() {
        if (entries.size() < maxEntries) return;
        Iterator<Map.Entry<Key, Entry>> iterator = entries.entrySet().iterator();
        while (iterator.hasNext()) {
            if (iterator.next().getValue().evictableTerminal()) {
                iterator.remove();
                return;
            }
        }
        throw new IllegalStateException("助手请求较多，请稍后重试");
    }

    enum CancelStatus { CANCELED, COMPLETED }
    enum Phase { PREPARING, GENERATING, VALIDATING, REPAIRING, COMPLETED, CANCELED, FAILED, NOT_FOUND }

    static final class Entry {
        private final long ttlNanos;
        private long expiresAt;
        private boolean canceled;
        private boolean completed;
        private boolean failed;
        private Phase phase = Phase.PREPARING;
        private Future<?> task;
        private CompletableFuture<?> stream;

        private Entry(long now, long ttlNanos) {
            this.ttlNanos = ttlNanos;
            this.expiresAt = now + ttlNanos;
        }

        synchronized boolean isCanceled() { return canceled; }

        synchronized Phase phase() { return phase; }

        synchronized void setPhase(Phase phase) {
            if (!terminal()) this.phase = phase;
        }

        synchronized void checkCanceled() {
            if (canceled) throw new CancellationException("助手请求已取消");
        }

        void setTask(Future<?> task) {
            boolean cancel;
            synchronized (this) {
                this.task = task;
                cancel = canceled;
            }
            if (cancel) task.cancel(true);
        }

        void setStream(CompletableFuture<?> stream) {
            boolean cancel;
            synchronized (this) {
                this.stream = stream;
                cancel = canceled;
            }
            if (cancel) stream.cancel(true);
        }

        synchronized void clearStream(CompletableFuture<?> stream) {
            if (this.stream == stream) this.stream = null;
        }

        CancelStatus cancel(long now) {
            Future<?> currentTask;
            CompletableFuture<?> currentStream;
            synchronized (this) {
                if (completed || failed) return CancelStatus.COMPLETED;
                if (canceled) return CancelStatus.CANCELED;
                canceled = true;
                phase = Phase.CANCELED;
                expiresAt = now + ttlNanos;
                currentTask = task;
                currentStream = stream;
            }
            if (currentStream != null) currentStream.cancel(true);
            if (currentTask != null) currentTask.cancel(true);
            return CancelStatus.CANCELED;
        }

        synchronized boolean complete(long now) {
            if (terminal()) return false;
            completed = true;
            phase = Phase.COMPLETED;
            task = null;
            stream = null;
            expiresAt = now + ttlNanos;
            return true;
        }

        synchronized void fail(long now) {
            if (canceled || completed || failed) return;
            failed = true;
            phase = Phase.FAILED;
            task = null;
            stream = null;
            expiresAt = now + ttlNanos;
        }

        synchronized boolean expired(long now) {
            return terminal() && now - expiresAt >= 0;
        }

        synchronized boolean terminal() { return completed || canceled || failed; }
        synchronized boolean evictableTerminal() { return completed || failed; }
    }

    private record Key(String user, UUID requestId) { }
}
