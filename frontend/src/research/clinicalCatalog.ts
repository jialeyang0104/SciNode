import type {ResearchTaskPreset} from './nodeFormLogic';

export const clinicalTaskPresets:ResearchTaskPreset[]=[
 {id:'picos',stage:'立项与设计',label:'PICOS 问题转化',guidance:'明确人群、干预/暴露、对照、结局、设计与时间窗。',prompt:'把临床想法转化为 PICOS：人群、干预或暴露、对照、主要和次要结局、研究设计与时间窗。区分已确定定义、建议及待确认内容。\n{{input.text}}'},
 {id:'time-zero',stage:'立项与设计',label:'纳排标准与时间零点核查',guidance:'检查入组、暴露确定、随访起点与永生时间偏倚。',prompt:'逐项检查纳排标准、入组时点、暴露判定窗口、随访起点和终点。用具体时间顺序识别永生时间偏倚、选择偏倚和反向因果的触发条件，提出可执行修订；未提供信息列待确认。\n{{input.text}}'},
 {id:'table1-interpretation',stage:'统计与图表解读',label:'Table 1 临床解读',guidance:'核对分母、缺失与 SMD，形成基线特征结果段。',prompt:'解读基线表，保留每组分母和缺失数，识别绝对 SMD>0.1 的变量；若原表提供 P 值，说明对应检验与比较范围。混杂因素结合研究设计选择，不能仅按基线显著性决定。输出与表格数值一致的 Results 草稿及临床核对项。\n{{input.text}}'},
 {id:'regression-interpretation',stage:'统计与图表解读',label:'回归与生存结果解读',guidance:'区分 OR、HR、RR，结合区间、绝对风险与研究设计解释。',prompt:'逐项核对 OR/HR/RR、参考组、95% CI、P 值、调整变量、有效样本与事件数。区分统计显著性和临床意义，HR 不解释为累积风险比；观察性研究使用关联表述。缺少绝对风险时标记待补，不推算未知临床获益。\n{{input.text}}'},
 {id:'reporting-checklist',stage:'论文与投稿',label:'STROBE / CONSORT 规范核查',guidance:'按实际研究设计选择清单，逐项给出文稿证据和缺口。',prompt:'依据实际设计选 STROBE（观察性研究）或 CONSORT（随机试验）核对。逐项给出文稿位置、已报告内容、缺口和修改建议，特别检查纳排流程、时间零点、随访时长与失访、缺失值、效应量区间、敏感性分析。未执行事项列待办，不伪造分析。\n{{input.text}}'},
 {id:'reviewer-response',stage:'论文与投稿',label:'审稿意见逐条回复',guidance:'把文字修改与需要补做的分析分开，保留原意见及定位。',prompt:'逐条保留审稿意见，组织为意见、答复要点、拟修改位置和所需证据。区分文字修改、数据核对、补做亚组/敏感性分析和需作者决定事项；仅将材料中已有运行证据的分析写为已完成。\n{{input.text}}'},
];

export const projectPresets=[
 {value:'cohort',label:'回顾性队列研究 · STROBE',category:'临床研究',description:'研究定义 → 临床表格 → 质量与变量核对 → Table 1 → 回归 → 审阅 → 报告。导入真实数据后选择列名与模型。'},
 {value:'prediction',label:'预测模型构建与验证 · TRIPOD+AI',category:'临床研究',description:'二分类结局、每位患者一行；预先指定预测因子，训练集内预处理，内部留出验证 AUC、校准及 DCA。'},
 {value:'systematic',label:'系统评价证据提取 · PRISMA',category:'临床研究',description:'PICOS → PubMed 摘要 → 初筛 → 效应量提取 → 偏倚初评 → 人工逐篇核对。缺少全文的项目保留待核对状态。'},
 {value:'protocol',label:'临床研究方案与伦理自查',category:'临床研究',description:'研究假设 → 方案结构与样本量依据 → 伦理自查 → 人工确认 → Word 方案。按设计选用 SPIRIT / CONSORT。'},
 {value:'patent',label:'专利修订',category:'专利与方案',description:'原稿读取、审阅、修订补丁和保留图表的 Word 导出。'},
 {value:'literature',label:'文献整理',category:'文献研究',description:'检索题录与摘要，形成可追溯的证据报告。'},
 {value:'analysis',label:'数据分析（合成示例）',category:'数据分析',description:'合成数据演示脚本、检查与导出约定。'},
 {value:'blank',label:'空白流程',category:'其他科研',description:'从研究问题开始，逐步添加任务。'},
];

export const statisticPresets=[
 {value:'table1',label:'基线特征表',description:'选择分组、连续与分类变量，输出 Table 1 和两组 SMD。'},
 {value:'quality',label:'缺失与数据质量',description:'各列缺失、IQR 异常值、重复记录和患者 ID 检查。'},
 {value:'regression',label:'结局关联分析',description:'Logistic / Cox、OR / HR、置信区间与森林图。'},
 {value:'km',label:'Kaplan–Meier 曲线',description:'生存曲线、风险人数表和 Log-rank 检验。'},
 {value:'prediction',label:'预测模型内部验证',description:'预设预测因子，训练/验证分离，AUC、校准和 DCA。'},
];
