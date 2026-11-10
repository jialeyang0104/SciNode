package com.scinode.research;

import com.alibaba.fastjson2.JSONArray;
import java.util.*;

/** Clinical workflows start with definitions and real files; no fabricated analysis data. */
final class ClinicalTemplates {
    static final Set<String> IDS=Set.of("cohort","prediction","systematic","protocol");
    static void add(JSONArray nodes,String template){
        if("systematic".equals(template)){
            node(nodes,"question","input","PICOS 与筛选标准",Map.of("text","请填写：目标人群、干预/暴露、对照、结局、研究设计；检索截止日期；纳排标准。"));
            node(nodes,"search","pubmed","检索文献与结构化摘要",Map.of("query","heat stroke AND rehabilitation","limit",20));
            llm(nodes,"screen","PICOS 初筛","依据 PICOS 对每篇摘要初筛，逐篇保留 PMID、判断（纳入/排除/待全文）及理由。题录去重、筛选与 PRISMA 计数仅基于本次真实记录；摘要不足标记待全文。标准：{{question.text}}\n文献：{{search.text}}");
            llm(nodes,"extract","提取效应量与证据表","逐篇提取设计、人群、样本量、效应类型 OR/HR/RR、估计值、95% CI、调整因素、随访期和原句证据。保留 PMID/DOI。缺失字段写“未报告”；不可用标题推断结果。全文不足标记待全文。初筛：{{screen.text}}\n原始记录：{{search.text}}");
            llm(nodes,"bias","偏倚风险初评","按实际研究设计选择 RoB 2（随机试验）或 ROBINS-I/NOS（非随机研究），按领域给出证据原句与待核实项。摘要不足不得完成低风险判定。证据表：{{extract.text}}\n原始摘要：{{search.text}}");
            review(nodes,"PRISMA 证据提取复核",List.of("已逐篇核对 PMID、纳排理由与去重记录","效应量、方向、95% CI 已与来源核对","摘要不足和未报告项已标记，需全文者未作最终偏倚判定"),"{{extract.text}}","{{bias.text}}");
        }else if("protocol".equals(template)){
            node(nodes,"question","input","临床问题与研究假设",Map.of("text","请填写疾病/人群、干预/暴露、对照、研究类型、主要与次要终点、可用数据和预期样本来源。"));
            llm(nodes,"design","方案结构与样本量依据","将临床问题组织为研究方案：背景、PICOS、纳排、时间零点、随访、主次要终点、样本量依据所需参数、分析计划。适用时按 SPIRIT 列出随机化、盲法和揭盲；观察性研究注明不适用。缺少发生率/效应量/功效时列待提供，不编造样本量。\n{{question.text}}");
            llm(nodes,"ethics","伦理与偏倚自查","审阅方案中的知情同意/豁免依据、隐私、风险获益、不良事件定义及报告、退出、盲法、分配隐藏和偏倚控制。按研究设计区分 SPIRIT 方案项目与 CONSORT 结果报告项目。输出可修改内容及待伦理委员会/研究者决定事项。\n{{design.text}}");
            review(nodes,"确认方案与伦理待办",List.of("纳排标准、时间零点与主次终点已核对","样本量依据和缺失参数已确认","知情同意、不良事件与伦理待办已明确"),"{{design.text}}","{{ethics.text}}");
        }else{
            boolean prediction="prediction".equals(template);
            node(nodes,"question","input",prediction?"定义结局与候选预测因子":"PICO、纳排标准与时间零点",Map.of("text",prediction?
                "请填写目标人群、预测时点、预测窗口、二分类结局、候选预测因子及其可获得时间、患者 ID。每位患者一行；按方案预先指定变量。":
                "请填写研究问题、人群、暴露与对照、结局、纳排标准、时间零点、随访、混杂因素及缺失值处理方案。"));
            node(nodes,"table","document","导入临床 CSV / Excel",Map.of());
            node(nodes,"quality","python","数据质量体检",Map.of("analysisPreset","quality","analysis",Map.of(),"inputs",Map.of("dataPath","{{table.dataPath}}","sheet","{{table.sheet}}")));
            llm(nodes,"dictionary","变量与研究定义核对","对照研究定义和数据字典，逐项核对变量、单位、编码、时间零点、结局与缺失。指出永生时间偏倚和混杂控制需确认的定义。\n研究定义：{{question.text}}\n字典：{{table.text}}\n质量：{{quality.text}}");
            node(nodes,"baseline","python","基线特征表 Table 1",Map.of("analysisPreset","table1","analysis",Map.of(),"inputs",Map.of("dataPath","{{table.dataPath}}","sheet","{{table.sheet}}")));
            node(nodes,"analysis","python",prediction?"预测模型与内部验证":"调整后结局关联分析",Map.of("analysisPreset",prediction?"prediction":"regression","analysis",Map.of("method","logistic","eventValue","1","seed",2026,"testFraction",0.25),"timeout",300,"inputs",Map.of("dataPath","{{table.dataPath}}","sheet","{{table.sheet}}")));
            llm(nodes,"review",prediction?"TRIPOD+AI 报告复核":"STROBE 报告复核",(prediction?
                "按 TRIPOD+AI 核对预测时点、变量可获得时间、训练/验证样本、缺失处理、防泄漏、AUC 区间、校准、临床净获益与外部验证状态。单次内部留出结果需明确标记，不自动作临床可用结论。":
                "按 STROBE 核对纳排人数、时间零点、混杂因素、效应量与区间、缺失处理和敏感性分析。关联用语与设计一致。未执行的分析列待办，纳排人数未提供不得补造。")+
                "\n研究：{{question.text}}\n定义核对：{{dictionary.text}}\n基线：{{baseline.text}}\n分析：{{analysis.text}}\n输出结构化报告草稿和待确认清单。");
            review(nodes,prediction?"确认预测模型报告":"临床专家确认结果",List.of("纳排标准、结局与时间窗已和研究方案核对","缺失值处理、分析样本及变量编码已核对",prediction?"训练/验证划分、泄漏检查和内部验证范围已确认":"调整变量、效应方向及关联表述已核对"),"{{review.text}}","{{analysis.text}}");
        }
        node(nodes,"report","export","导出临床研究报告",Map.of("format","docx","inputs",Map.of("text","{{confirm.text}}")));
    }
    private static void llm(JSONArray nodes,String id,String title,String prompt){node(nodes,id,"llm",title,Map.of("prompt",prompt));}
    private static void review(JSONArray nodes,String question,List<String> checklist,String text,String review){
        node(nodes,"confirm","approve",question,Map.of("question",question,"reviewChecklist",checklist,"inputs",Map.of("text",text,"review",review)));
    }
    private static void node(JSONArray nodes,String id,String kind,String label,Map<String,Object> config){ResearchTemplates.add(nodes,id,kind,label,config);}
}
