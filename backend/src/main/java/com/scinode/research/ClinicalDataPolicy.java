package com.scinode.research;

import com.alibaba.fastjson2.*;
import java.util.*;
import java.util.regex.*;

/** Enforce clinical table boundaries before resolving outbound model/tool materials. */
final class ClinicalDataPolicy {
    private static final Pattern REF=Pattern.compile("\\{\\{\\s*([a-zA-Z0-9_-]+)\\.([a-zA-Z0-9_.-]+)\\s*}}");
    static void validateOutbound(String id,JSONObject data,JSONObject project) {
        if(!project.getBooleanValue("clinicalData")||!Set.of("llm","mcp","pubmed").contains(data.getString("kind")))return;
        Object value="llm".equals(data.getString("kind"))?data.get("prompt"):"mcp".equals(data.getString("kind"))?data.get("arguments"):data.get("query");
        validateValue(value,project,new HashSet<>());
    }
    private static void validateValue(Object value,JSONObject project,Set<String> visiting) {
        Matcher matcher=REF.matcher(JSON.toJSONString(value));
        while(matcher.find()){
            String source=matcher.group(1),field=matcher.group(2);
            if("input".equals(source))continue;
            String key=source+"."+field;
            if(!visiting.add(key))throw new IllegalArgumentException("临床资料来源存在循环: "+source);
            JSONObject node=project.getJSONArray("nodes").stream().map(o->(JSONObject)o).filter(n->source.equals(n.getString("id"))).findFirst().orElseThrow();
            JSONObject data=node.getJSONObject("data");String kind=data.getString("kind");
            if("approve".equals(kind)||"check".equals(kind)){
                Object mapped=data.getJSONObject("inputs")==null?null:data.getJSONObject("inputs").get(field);
                if(mapped!=null)validateValue(mapped,project,visiting);
                else if(!Set.of("text","passed","approved","decision").contains(field))blocked(data);
            }else if("document".equals(kind)){
                String fid=data.getString("fileId");
                boolean table=project.getJSONArray("files").stream().map(o->(JSONObject)o).anyMatch(f->Objects.equals(fid,f.getString("id"))&&f.getString("name").toLowerCase().matches(".*\\.(csv|xlsx)$"));
                if(!table||data.getBooleanValue("rawDocument")||!Set.of("text","summary","n").contains(field))blocked(data);
            }else if(Set.of("python","r").contains(kind)){
                if(!Set.of("quality","table1","regression","km","prediction").contains(Objects.toString(data.getString("analysisPreset"),""))||!Set.of("text","summary","n","figureCount").contains(field))blocked(data);
            }else if(!Set.of("input","llm","pubmed").contains(kind))blocked(data);
            visiting.remove(key);
        }
    }
    private static void blocked(JSONObject data){throw new IllegalArgumentException("临床个体资料不能直接发送到模型或联网工具：“"+data.getString("label")+"”。请选择内置数据字典或统计任务的正文/汇总输出。");}
}
