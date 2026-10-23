package com.scinode.service;
import com.scinode.entity.McpToolConfig;
import com.scinode.dto.McpToolConfigRequest;
import com.alibaba.fastjson2.JSON;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class McpCredentialUpdateTest {
 @Test void maskedCredentialsRetainActualStoredValue(){
  var service=spy(new McpToolConfigService(mock(SearchInfinityMcpClient.class)));
  McpToolConfig c=new McpToolConfig();c.setId(1L);c.setEnv("{\"API_KEY\":\"stored-secret\",\"REGION\":\"local\"}");doReturn(c).when(service).requireConfig(1L);doReturn(true).when(service).updateById(any(McpToolConfig.class));
  McpToolConfigRequest r=new McpToolConfigRequest();r.setName("fixture");r.setToolName("echo");r.setCommand("python3");r.setEnv(Map.of("API_KEY","******","REGION","updated"));
  Map<String,Object> result=service.updateConfig(1L,r);assertEquals("stored-secret",JSON.parseObject(c.getEnv()).getString("API_KEY"));assertEquals("updated",JSON.parseObject(c.getEnv()).getString("REGION"));assertFalse(JSON.toJSONString(result).contains("stored-secret"));
  r.setEnv(Map.of("API_KEY","new-secret"));service.updateConfig(1L,r);assertEquals("new-secret",JSON.parseObject(c.getEnv()).getString("API_KEY"));
 }
}
