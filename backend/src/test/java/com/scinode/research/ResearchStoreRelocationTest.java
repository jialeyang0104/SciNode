package com.scinode.research;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;
class ResearchStoreRelocationTest {
 @TempDir Path temp;
 @Test void mapsRecordedPathsAndPreservesExternalPaths() throws Exception {
  Path old=temp.resolve("before"),current=temp.resolve("after"),file=current.resolve("workspaces/input.txt");
  Files.createDirectories(file.getParent());Files.writeString(file,"preserved evidence");
  var store=new ResearchStore(temp.resolve("data").toString(),old.toString(),current.toString());
  assertEquals(file,store.resolvePath(old.resolve("workspaces/input.txt").toString()));
  assertEquals("preserved evidence",Files.readString(store.resolvePath(old.resolve("workspaces/input.txt").toString())));
  Path external=temp.resolve("before-extra/input.txt");assertEquals(external,store.resolvePath(external.toString()));
 }
 @Test void requiresCompleteRelocationConfiguration() {
  assertThrows(IllegalArgumentException.class,()->new ResearchStore(temp.toString(),"/prior",""));
 }
}
