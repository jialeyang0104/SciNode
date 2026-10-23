import type {Kind,ResearchData} from './types';
import type {ResearchTaskPreset} from './nodeFormLogic';
export const pythonSample=`import json, os
from pathlib import Path
import pandas as pd
out = Path(os.environ['SCINODE_OUTPUT'])
out.mkdir(exist_ok=True)
inputs = json.loads(Path(os.environ['SCINODE_INPUT']).read_text())
df = pd.DataFrame({'value': [1.2, 2.4, None, 3.1, 1.8]})
df.to_csv(out / 'synthetic_data.csv', index=False)
summary = {'n': len(df), 'observed': int(df.value.notna().sum()), 'missing': int(df.value.isna().sum()), 'mean_observed': float(df.value.mean())}
text = '合成示例数据：' + json.dumps(summary, ensure_ascii=False)
(out / 'result.json').write_text(json.dumps({'n': len(df), 'summary': summary, 'text': text}, ensure_ascii=False), encoding='utf-8')
print(text)`;
export const rSample=`library(jsonlite)
out <- Sys.getenv('SCINODE_OUTPUT')
dir.create(out, showWarnings = FALSE)
inputs <- fromJSON(Sys.getenv('SCINODE_INPUT'))
x <- c(1.2, 2.4, NA, 3.1, 1.8)
summary <- list(n = length(x), observed = sum(!is.na(x)), missing = sum(is.na(x)), mean_observed = mean(x, na.rm = TRUE))
text <- paste('合成示例数据：', toJSON(summary, auto_unbox = TRUE))
write_json(list(n = length(x), summary = summary, text = text), file.path(out, 'result.json'), auto_unbox = TRUE)
write.csv(data.frame(value=x), file.path(out, 'synthetic_data.csv'), row.names = FALSE)
cat(text)`;
export const llmTaskPresets:ResearchTaskPreset[]=[
 {id:'protocol-review',label:'方案审阅',guidance:'按研究问题、人群、暴露/干预、结局、时间窗、混杂和缺失数据审阅定义；把未提供的信息列为待确认。',prompt:'请审阅以下科研方案。依次检查研究问题与目标人群、纳排标准和时间零点、暴露/干预与结局定义、随访窗口和删失、混杂控制与缺失数据、数据来源与可执行性。\n输出：审阅结论、关键问题（严重度/材料依据/建议）、定义冲突、待研究者确认。区分方案中明确写出的内容与审阅建议；未提供的信息列为待确认，不自行补全。\n\n方案材料：\n{{input.text}}'},
 {id:'literature-extraction',label:'文献提取',guidance:'按研究设计、人群、干预/暴露、对照、结局和结果提取；保留 PMID/DOI，未提供字段明确标出。',prompt:'请从以下文献材料逐篇提取题名、PMID/DOI、研究设计、研究对象、干预或暴露、对照、结局、主要结果、随访和局限。输出为字段固定的表格，并列出来源信息缺失和需要查看原文的项目。只提取输入明确出现的内容；未提供字段写“未提供”，不要从题名或常识推断。\n\n文献材料：\n{{input.text}}'},
 {id:'evidence-map',label:'证据整理',guidance:'主张与来源逐项对应，区分观察结果、作者解释、推断和待验证假设；保留矛盾与阴性结果。',prompt:'请将以下材料整理成证据表：研究主张、来源标识、研究设计/样本、原始观察或结果、作者解释、证据限制、证据状态（直接报告/推断/待验证）。相互矛盾和阴性结果单独列出。材料没有给出的来源、样本量或结论写“未提供”，不得补造引用。\n\n待整理材料：\n{{input.text}}'},
 {id:'variable-dictionary',label:'变量字典',guidance:'提取变量含义、原始类型、单位/编码、时间锚点、缺失含义与来源；未知项留给研究者确认。',prompt:'请依据以下数据字典或字段说明整理变量表，列为：字段名、研究含义、原始类型、单位/编码、采集时间锚点、缺失/特殊值、来源表/字段、待确认问题。保留原始字段名和已有单位。未说明内容写“未提供”；不得把未知、未测量或缺失编码解释为阴性或零。\n\n数据说明：\n{{input.text}}'},
 {id:'revision-plan',label:'修订计划',guidance:'逐项关联原文、修改目标和证据；区分可直接修改的文字与需补充数据/来源支持的内容。',prompt:'请针对以下稿件或审阅意见形成可执行的修订计划。逐项列出优先级、原文位置/问题、修改目标、建议动作、对应证据或需补充材料、作者需确认问题。把可直接修改的文字问题与需要新增数据/来源支持的问题分开；不要虚构研究发现、参考文献或已完成分析。\n\n输入材料：\n{{input.text}}'},
 {id:'results-review',label:'结果表述复核',guidance:'核对分母、方向、单位、区间、缺失与阴性结果，并检查结论是否超出研究设计支持范围。',prompt:'请复核以下结果文字与随附表格/输出是否一致。检查分析样本与分母、效应方向和单位、置信区间与 P 值、缺失/未估计结果、阴性或不利结果是否完整，以及结论是否超出研究设计支持范围。逐项给出原句、核对结果、依据和建议改写；材料不足的项目列为待核对。\n\n结果材料：\n{{input.text}}'},
];
export const catalog:Record<Kind,{label:string;icon:string;description:string;outputs:string[];example:Partial<ResearchData>}>={
 mcp:{label:'MCP工具',icon:'⚙',description:'调用项目或全局已启用的科研工具。读取工具说明后按参数类型填写；调用状态与结果保存在运行记录中。',outputs:['text','content','structuredContent'],example:{arguments:{query:'heat stroke rehabilitation'}}},
 input:{label:'任务输入',icon:'✎',description:'记录目标、背景、材料范围和交付要求；下游节点可从这里引用 text。',outputs:['text'],example:{text:'研究目标：整理热射病康复设备方案。输出：修改计划、修订稿与待确认事项。'}},
 document:{label:'文档读取',icon:'▤',description:'读取已导入的 Word、可提取文字的 PDF 或文本文件；原文件保持不变。',outputs:['text','paragraphs','tables','sourceName','sourceSha256'],example:{}},
 llm:{label:'科研任务',icon:'◈',description:'从科研任务预设开始，或自由编写提示词；核对任务和输入材料后再运行。',outputs:['text','model'],example:{prompt:'根据以下资料列出修改计划、证据状态和待人工确认事项。\n{{input.text}}'}},
 pubmed:{label:'PubMed检索',icon:'⌕',description:'按 PubMed 检索式获取文献元数据，记录 PMID、链接、检索时间和命中数。',outputs:['text','papers','query','total','searchedAt'],example:{query:'heat stroke AND rehabilitation',limit:10}},
 python:{label:'Python脚本',icon:'Py',description:'运行已确认的 Python 脚本。SCINODE_INPUT 是输入 JSON 文件，SCINODE_OUTPUT 是本节点成果目录。',outputs:['text','stdout','stderr','exitCode','n','summary'],example:{script:pythonSample,timeout:120}},
 r:{label:'R脚本',icon:'R',description:'运行已确认的 R 脚本。通过环境变量读取输入和输出目录；日志与退出码写入运行记录。',outputs:['text','stdout','stderr','exitCode','n','summary'],example:{script:rSample,timeout:120}},
 check:{label:'质量检查',icon:'✓',description:'核对输入映射中必需字段是否存在且非空，并提供逐字段检查结果。',outputs:['text','passed','checks'],example:{requiredFields:['text'],inputs:{text:'{{input.text}}'}}},
 approve:{label:'人工确认',icon:'☑',description:'运行到此节点时暂停，展示确认问题与上游材料；由你批准或退回。',outputs:['text','approved','decision'],example:{question:'请确认当前材料、修改范围和证据边界；填写确认意见或退回原因。',inputs:{text:'{{input.text}}'}}},
 export:{label:'文档导出',icon:'⇩',description:'将映射的 text 导出为 Word、PDF 或文本。选择原 Word 并映射 patches 时，可按段落索引修订原文并保留图表。',outputs:['text','fileName','exportMode'],example:{format:'docx',inputs:{text:'{{input.text}}'}}},
 package:{label:'成果整理',icon:'▣',description:'将本次运行的成果、来源、节点结果、配置和人工决策打包为 ZIP。',outputs:['text','fileName','manifest'],example:{}},
};

export const nodeGuidance:Record<Kind,string[]>={
 mcp:['先在项目或全局设置中启用此工具，再读取参数说明。','必需参数标有 *；已有但不在说明中的参数保留在“其他已有参数”中。'],
 input:['写清研究目标、材料范围、已知事实和交付要求。','正式分析前，先核对人群、变量、结局与时间范围。'],
 document:['先将资料导入项目，再选择文件。','Word 还会输出带段落索引的文字和表格。'],
 llm:['可以从科研任务预设开始，也可以直接编写自己的任务提示词。','套用预设只替换提示词，保留模型、文件和输入映射。'],
 pubmed:['检索式支持 PubMed 字段和布尔运算符。','返回题录/摘要信息；需要全文信息时另行导入并读取原文。'],
 python:['脚本是自定义执行内容；运行前检查代码与使用的输入。','合成数据示例只演示 result.json 输出，正式分析请替换为已确认的数据处理流程。'],
 r:['脚本是自定义执行内容；运行前检查代码与使用的输入。','合成数据示例只演示 result.json 输出，正式分析请替换为已确认的数据处理流程。'],
 check:['必需字段名必须与下方输入映射的字段名一致。','核对字段完整性，研究设计与证据交由人工确认。'],
 approve:['把需要人决定的问题写清楚，并映射需要查看的资料。','工作流会在此暂停，确认后才继续后续节点。'],
 export:['text 是必填输入；选原 Word 并传入 patches 可按段落修订并保留图表。','不选原文件时将以 text 新建文档。'],
 package:['无需额外参数，会打包本次运行已生成的成果与记录。','运行后可下载检查并冻结此次成果。'],
};
export const outputPreviews:Record<Kind,string>={
 mcp:'文字、结构化内容和调用状态，具体字段由所选工具决定。',
 input:'text：本次工作流的任务背景。',
 document:'text：全文摘录\nparagraphs：带段落索引的文字\ntables：识别到的表格',
 llm:'text：模型生成的任务结果\nmodel：此次实际使用的模型',
 pubmed:'papers：题录与 PMID/链接\ntotal：命中数\nsearchedAt：检索时间',
 python:'result.json 中的字段成为可引用输出，例如 n、summary、text。',
 r:'result.json 中的字段成为可引用输出，例如 n、summary、text。',
 check:'passed：是否通过\nchecks：逐字段检查结果\ntext：质量检查通过',
 approve:'approved：是否通过\ndecision：确认或退回意见\ntext：确认后传递的材料',
 export:'text：导出状态\nfileName：成果文件名\nexportMode：indexed_patches 或 new_report',
 package:'text：成果包状态\nfileName：ZIP 文件名\nmanifest：包内文件清单',
};

export const categories=['专利与方案','文献研究','临床研究','数据分析','组学研究','其他科研'];
