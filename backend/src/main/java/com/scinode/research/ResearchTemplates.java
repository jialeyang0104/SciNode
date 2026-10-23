package com.scinode.research;

import com.alibaba.fastjson2.*;
import java.util.*;

final class ResearchTemplates {
    static JSONObject flow(String template){
        JSONArray nodes=new JSONArray(),edges=new JSONArray();
        if("literature".equals(template)){
            add(nodes,"search","pubmed","PubMed文献检索",Map.of("query","heat stroke AND rehabilitation","limit",10));
            add(nodes,"summarize","llm","证据整理",Map.of("prompt","按研究设计、人群、主要结局和局限整理以下PubMed记录。保留PMID和链接。摘要元数据之外的信息标为待查原文。\n{{search.text}}"));
            add(nodes,"confirm","approve","确认文献材料",Map.of("question","确认检索范围、文献来源和证据边界；填写待补原文或调整意见。","inputs",Map.of("text","{{summarize.text}}")));
            add(nodes,"report","export","导出文献报告",Map.of("format","docx","inputs",Map.of("text","{{confirm.text}}")));
        }else if("analysis".equals(template)){
            add(nodes,"source","input","示例分析计划",Map.of("text","本模板使用合成示例数据，演示描述性汇总与缺失检查。正式科研分析由项目方案另行确认。"));
            add(nodes,"confirm","approve","确认分析范围",Map.of("question","确认当前示例数据与描述性分析范围。正式研究需先确认人群、变量、结局及模型。","inputs",Map.of("text","{{source.text}}")));
            add(nodes,"analyze","python","示例数据分析",Map.of("script",PYTHON_SAMPLE,"timeout",120));
            add(nodes,"quality","check","结果完整性检查",Map.of("requiredFields",List.of("n","summary"),"inputs",Map.of("n","{{analyze.n}}","summary","{{analyze.summary}}")));
            add(nodes,"report","export","导出分析报告",Map.of("format","docx","inputs",Map.of("text","{{analyze.text}}")));
        }else if("blank".equals(template)){
            add(nodes,"source","input","研究任务输入",Map.of("text","请填写项目目标、输入资料、成果要求与确认事项。"));
        }else{
            add(nodes,"source","document","读取专利草案",Map.of());
            add(nodes,"plan","llm","规划与审阅",Map.of("prompt","审阅这份科研设备专利草案，列出修改计划、结构一致性问题和待补证据。工程实现、临床效果、专利新颖性分别标注证据状态。\n{{source.text}}"));
            add(nodes,"revise","llm","形成修订补丁",Map.of("prompt","根据审阅计划修订草案。只输出JSON对象{\"patches\":[{\"index\":段落索引,\"original\":原段落全文,\"text\":替换后的全文}]}，保留段落索引，原文逐字匹配。修改有实质问题的文字段落，保留图表段落。所有临床与工程效果保留证据边界。\n计划：{{plan.text}}\n段落：{{source.paragraphs}}"));
            add(nodes,"review","llm","修订内容复核",Map.of("prompt","核对以下修订补丁与原文的定义、结构、权利要求和证据表达是否一致。列出通过项、失败项及待人工确认项。该复核是额外AI检查，记录检查范围。\n原文：{{source.text}}\n补丁：{{revise.text}}"));
            add(nodes,"confirm","approve","确认修订方案",Map.of("question","检查修订补丁及AI复核结果。确认后导出修订稿，填写结论与待补证据。","inputs",Map.of("text","{{revise.text}}","patches","{{revise.text}}","review","{{review.text}}")));
            add(nodes,"report","export","导出保留图表的修订稿",Map.of("format","docx","inputs",Map.of("text","{{confirm.text}}","patches","{{confirm.patches}}")));
        }
        if(!"blank".equals(template))add(nodes,"package","package","整理成果与记录",Map.of());
        for(int i=1;i<nodes.size();i++){JSONObject before=nodes.getJSONObject(i-1),after=nodes.getJSONObject(i);edges.add(new JSONObject(Map.of("id",before.getString("id")+"_"+after.getString("id"),"source",before.getString("id"),"target",after.getString("id"))));}
        // Patent export additionally needs the original file, selected alongside its document source in the UI.
        return new JSONObject(Map.of("nodes",nodes,"edges",edges));
    }
    private static void add(JSONArray nodes,String id,String kind,String label,Map<String,Object> settings){
        JSONObject data=new JSONObject(settings);data.put("kind",kind);data.put("label",label);data.putIfAbsent("inputs",new JSONObject());
        nodes.add(new JSONObject(Map.of("id",id,"type","research","position",Map.of("x",(nodes.size()%3)*300,"y",(nodes.size()/3)*180),"data",data)));
    }
    static final String PYTHON_SAMPLE="""
import json, os
from pathlib import Path
import pandas as pd
out = Path(os.environ['SCINODE_OUTPUT'])
out.mkdir(exist_ok=True)
df = pd.DataFrame({'subject': [1, 2, 3, 4, 5], 'value': [1.2, 2.4, None, 3.1, 1.8]})
df.to_csv(out / 'synthetic_data.csv', index=False)
summary = {'n': len(df), 'observed': int(df['value'].notna().sum()), 'missing': int(df['value'].isna().sum()), 'mean_observed': float(df['value'].mean())}
text = '合成示例数据的描述性汇总：' + json.dumps(summary, ensure_ascii=False) + '\\n缺失值按缺失保留；本次演示范围为描述性汇总。'
(out / 'result.json').write_text(json.dumps({'n': len(df), 'summary': summary, 'text': text}, ensure_ascii=False), encoding='utf-8')
print(text)
""";
}
