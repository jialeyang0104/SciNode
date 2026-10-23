package com.scinode.research;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Local personal-project persistence; atomic replacement, explicit errors and owner isolation. */
@Component
public class ResearchStore {
    private final Path root;
    private final Path previousRoot;
    private final Path currentRoot;
    public ResearchStore(String directory) throws IOException { this(directory, "", ""); }
    @org.springframework.beans.factory.annotation.Autowired
    public ResearchStore(@Value("${scinode.data-dir:scinode-data}") String directory,
        @Value("${scinode.previous-root:}") String previous,
        @Value("${scinode.current-root:}") String current) throws IOException {
        if (previous.isBlank() != current.isBlank()) throw new IllegalArgumentException("目录迁移应同时配置原目录与当前目录");
        previousRoot = previous.isBlank() ? null : Path.of(previous).toAbsolutePath().normalize();
        currentRoot = current.isBlank() ? null : Path.of(current).toAbsolutePath().normalize();
        root = Path.of(directory).toAbsolutePath().normalize();
        Files.createDirectories(root);
        if(Files.getFileStore(root).supportsFileAttributeView("posix")) Files.setPosixFilePermissions(root,java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));
    }
    public Path resolvePath(String recorded) {
        Path path = Path.of(recorded).toAbsolutePath().normalize();
        return previousRoot != null && path.startsWith(previousRoot)
                ? currentRoot.resolve(previousRoot.relativize(path)) : path;
    }
    Path owner(String username) {
        return root.resolve(Base64.getUrlEncoder().withoutPadding().encodeToString(username.getBytes(StandardCharsets.UTF_8)));
    }
    Path file(String user, String kind, String id) {
        if (!id.matches("[a-zA-Z0-9_-]+")) throw new IllegalArgumentException("记录 ID 格式错误");
        return owner(user).resolve(kind).resolve(id + ".json");
    }
    public synchronized JSONObject read(String user, String kind, String id) throws IOException {
        Path p = file(user, kind, id);
        if (!Files.isRegularFile(p)) throw new IllegalArgumentException("记录尚未创建或当前账户无访问权限");
        return JSON.parseObject(Files.readString(p));
    }
    public synchronized void write(String user, String kind, JSONObject value) throws IOException {
        Path p = file(user, kind, value.getString("id"));
        Files.createDirectories(p.getParent());
        Path tmp = Files.createTempFile(p.getParent(), ".writing-", ".json");
        try {
            Files.writeString(tmp, JSON.toJSONString(value));
            Files.move(tmp, p, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(tmp); }
    }
    public synchronized void delete(String user, String kind, String id) throws IOException {
        Files.deleteIfExists(file(user, kind, id));
    }
    public synchronized List<JSONObject> list(String user, String kind) throws IOException {
        Path p = owner(user).resolve(kind);
        if (!Files.exists(p)) return List.of();
        List<JSONObject> records = new ArrayList<>();
        try (var files = Files.list(p)) {
            for (Path f : files.filter(f -> f.getFileName().toString().endsWith(".json")).toList())
                records.add(JSON.parseObject(Files.readString(f)));
        }
        records.sort(Comparator.comparing((JSONObject o) -> o.getString("updatedAt")).reversed());
        return records;
    }
    public static String hash(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    public static String hash(Path path) throws IOException { return hash(Files.readAllBytes(path)); }
}
