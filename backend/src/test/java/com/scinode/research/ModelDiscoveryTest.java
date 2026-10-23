package com.scinode.research;
import com.alibaba.fastjson2.JSONObject;
import com.scinode.entity.LLMGlobalConfig;
import com.scinode.service.LLMGlobalConfigService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class ModelDiscoveryTest {
 @Test void discoversActualIdsAndRejectsErrorsWithoutLeakingCredentials()throws Exception{
  HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/v1/models",exchange->{String body="{\"data\":[{\"id\":\"z-model\"},{\"id\":\"a-model\"},{\"id\":\"z-model\"}]}";if(!"Bearer fixture-secret".equals(exchange.getRequestHeaders().getFirst("Authorization")))body="{}";byte[] bytes=body.getBytes();exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();});server.start();
  try{String base="http://127.0.0.1:"+server.getAddress().getPort();ModelDiscovery discovery=new ModelDiscovery(mock(LLMGlobalConfigService.class));for(String suffix:List.of("","/v1","/v1/chat/completions","/v1/responses")){JSONObject result=discovery.discover(new JSONObject(Map.of("apiUrl",base+suffix,"apiKey","fixture-secret")));assertEquals(List.of("a-model","z-model"),result.getJSONArray("models"));assertFalse(result.toJSONString().contains("fixture-secret"));}
   Exception e=assertThrows(IllegalArgumentException.class,()->discovery.discover(new JSONObject(Map.of("apiUrl",base,"apiKey","wrong-secret"))));assertFalse(e.getMessage().contains("wrong-secret"));
  }finally{server.stop(0);}
 }

 @Test void savedInventoryIsNamedAndSelectionMustMatchEndpointIds()throws Exception{
  HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  AtomicReference<String> responseModel=new AtomicReference<>("port-model-a");AtomicInteger calls=new AtomicInteger();
  server.createContext("/v1/models",exchange->{calls.incrementAndGet();byte[] bytes=("{\"data\":[{\"id\":\""+responseModel.get()+"\"}]}").getBytes();exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();});server.start();
  try{
   String secret="saved-port-secret";LLMGlobalConfig config=new LLMGlobalConfig();config.setId(41L);config.setConfigName("local fixture");config.setApiUrl("http://127.0.0.1:"+server.getAddress().getPort());config.setApiKey(secret);config.setModel("port-model-a");
   LLMGlobalConfigService configs=mock(LLMGlobalConfigService.class);when(configs.getById(41L)).thenReturn(config);ModelDiscovery discovery=new ModelDiscovery(configs);
   JSONObject inventory=discovery.inventory(41L,false);assertEquals(41L,inventory.getLong("configId"));assertEquals("local fixture",inventory.getString("configName"));assertEquals(List.of("port-model-a"),inventory.getJSONArray("models").toJavaList(String.class));assertFalse(inventory.toJSONString().contains(secret));
   discovery.validateSelection(41L,"port-model-a");assertEquals(List.of("port-model-a"),discovery.knownModels(41L));
   assertThrows(IllegalArgumentException.class,()->discovery.validateSelection(41L,"model-from-another-port"));
   responseModel.set("port-model-b");config.setApiKey("replacement-secret");assertTrue(discovery.knownModels(41L).isEmpty());
   assertEquals(List.of("port-model-b"),discovery.inventory(41L,false).getJSONArray("models").toJavaList(String.class));
   assertEquals(2,calls.get());assertThrows(IllegalArgumentException.class,()->discovery.validateSelection(41L,"port-model-a"));discovery.validateSelection(41L,"port-model-b");
  }finally{server.stop(0);}
 }
}
