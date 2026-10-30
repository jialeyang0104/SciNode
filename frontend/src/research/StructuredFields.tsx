import {useEffect,useState} from 'react';
import {Button,Checkbox,Input,InputNumber,Select,Space} from 'antd';
import {DeleteOutlined,PlusOutlined} from '@ant-design/icons';
import {appendArrayValue,defaultForSchema,hasUnsupportedSchema,removeArrayValue,removeRecordKey,renameRecordKey,schemaFieldDefinitions,setRecordValue,type ValueRecord} from './nodeFormLogic';
import './StructuredFields.css';
import MarkdownPreview from './MarkdownPreview';

export interface ReadableValueProps {
  value: unknown;
  emptyLabel?: string;
  compact?: boolean;
}

export function FieldNameInput({value,onCommit,disabled=false,ariaLabel='字段名称'}:{value:string;onCommit:(value:string)=>boolean|void;disabled?:boolean;ariaLabel?:string}){
  const [draft,setDraft]=useState(value);
  useEffect(()=>setDraft(value),[value]);
  const commit=()=>{const next=draft.trim();if(next&&next!==value){if(onCommit(next)===false)setDraft(value);}else setDraft(value);};
  return <Input aria-label={ariaLabel} size="small" disabled={disabled} value={draft} onChange={event=>setDraft(event.target.value)} onBlur={commit} onPressEnter={event=>event.currentTarget.blur()}/>;
}

function valueKind(value: unknown) {
  if (value === null) return '空值';
  if (Array.isArray(value)) return `列表 · ${value.length} 项`;
  if (typeof value === 'object') return `对象 · ${Object.keys(value as object).length} 个字段`;
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return '数字';
  if (typeof value === 'string') return '文本';
  return '值';
}

const fieldNames:Record<string,string>={kind:'节点类型',label:'节点名称',description:'用途说明',config:'节点配置',configId:'模型配置编号',model:'实际模型',prompt:'任务提示词',script:'执行脚本',timeout:'超时秒数',inputs:'输入映射',input:'实际输入',output:'实际输出',arguments:'调用参数',mcpId:'MCP 工具编号',fileId:'项目文件编号',filePath:'原始文件路径',sourceFileId:'来源文件编号',text:'正文',query:'检索式',limit:'返回条数',format:'导出格式',requiredFields:'必需字段',question:'待确认问题',status:'执行状态',summary:'运行摘要',error:'错误信息',stdout:'标准输出',stderr:'错误输出',exitCode:'退出码',papers:'文献列表',total:'命中数',searchedAt:'检索时间',passed:'检查通过',checks:'检查项',approved:'已确认',decision:'确认意见',fileName:'成果文件名',exportMode:'导出方式',structuredContent:'结构化结果',content:'工具返回内容',sourceName:'来源文件',sourceSha256:'来源校验值',paragraphs:'段落列表',tables:'表格',revision:'项目版本',name:'名称',id:'编号',position:'画布位置',edges:'节点连接',nodes:'流程节点',createdAt:'创建时间',startedAt:'开始时间',finishedAt:'结束时间',elapsedMs:'耗时毫秒',frozen:'是否冻结'};
const kindNames:Record<string,string>={input:'任务输入',document:'文档读取',llm:'科研任务',mcp:'MCP工具',pubmed:'PubMed检索',python:'Python脚本',r:'R脚本',check:'质量检查',approve:'人工确认',export:'文档导出',package:'成果整理'};
const statusNames:Record<string,string>={QUEUED:'排队中',RUNNING:'执行中',WAITING_APPROVAL:'等待人工确认',PAUSED:'已暂停',SUCCESS:'成功',FAILED:'失败',REJECTED:'已退回',INTERRUPTED:'运行中断',CANCELLED:'已结束'};

function readableScalar(value:unknown,key?:string){
  if(value===null)return <span className="readable-null">空值</span>;
  if(typeof value==='boolean')return <span className="readable-bool">{value?'是':'否'}</span>;
  if(typeof value==='string'&&key==='kind')return <span className="readable-scalar">{kindNames[value]||value}{kindNames[value]&&<small> · {value}</small>}</span>;
  if(typeof value==='string'&&key==='status')return <span className="readable-scalar">{statusNames[value]||value}</span>;
  if(typeof value==='string'&&key==='exportMode')return <span className="readable-scalar">{value==='indexed_patches'?'按原 Word 段落修订':value==='new_report'?'新建报告':value}</span>;
  return <span className="readable-scalar">{String(value)}</span>;
}

function ReadableNode({value,emptyLabel,compact,depth=0,fieldKey=''}:{value:unknown;emptyLabel:string;compact:boolean;depth?:number;fieldKey?:string}){
  if(value===undefined)return <span className="readable-empty">{emptyLabel}</span>;
  if(Array.isArray(value))return value.length?<details className={`readable-value ${compact?'compact':''}`} open={depth===0}><summary>{valueKind(value)}</summary><ol className="readable-array">{value.map((item,index)=><li key={index}><span className="readable-index">{index+1}</span><ReadableNode value={item} emptyLabel={emptyLabel} compact={compact} depth={depth+1} fieldKey={fieldKey}/></li>)}</ol></details>:<span className="readable-empty">空列表</span>;
  if(value&&typeof value==='object'){
    const entries=Object.entries(value as Record<string,unknown>);
    return entries.length?<details className={`readable-value ${compact?'compact':''}`} open={depth===0}><summary>{valueKind(value)}</summary><dl className="readable-object">{entries.map(([key,item])=><div className="readable-row" key={key}><dt>{fieldNames[key]||key}{fieldNames[key]&&<small>{key}</small>}</dt><dd><ReadableNode value={item} emptyLabel={emptyLabel} compact={compact} depth={depth+1} fieldKey={key}/></dd></div>)}</dl></details>:<span className="readable-empty">空对象</span>;
  }
  if(typeof value==='string'&&!['script','stdout','stderr','error','query','filePath','path','id','sha256','sourceSha256'].includes(fieldKey))return <MarkdownPreview text={value}/>;
  return readableScalar(value,fieldKey);
}

export function ReadableValue({value,emptyLabel='暂无内容',compact=false}:ReadableValueProps){return <ReadableNode value={value} emptyLabel={emptyLabel} compact={compact}/>;}

interface StructuredFieldsProps {
  value: ValueRecord;
  onChange:(value:ValueRecord)=>void;
  disabled?:boolean;
  label?:string;
}

function emptyForType(type:string):unknown{return type==='object'?{}:type==='array'?[]:type==='number'?0:type==='boolean'?false:type==='null'?null:'';}

function EditableValue({value,onChange,disabled=false,depth=0}:{value:unknown;onChange:(value:unknown)=>void;disabled?:boolean;depth?:number}){
  if(depth>8)return <ReadableValue value={value}/>;
  if(Array.isArray(value))return <div className="structured-nested">
    <details open><summary>{valueKind(value)}</summary><div className="structured-array">{value.map((item,index)=><div className="structured-array-row" key={index}><EditableValue value={item} disabled={disabled} depth={depth+1} onChange={next=>onChange(value.map((entry,current)=>current===index?next:entry))}/><Button aria-label={`删除第 ${index+1} 项`} disabled={disabled} size="small" type="text" danger icon={<DeleteOutlined/>} onClick={()=>onChange(removeArrayValue(value,index))}/></div>)}
      <Button size="small" disabled={disabled} icon={<PlusOutlined/>} onClick={()=>onChange(appendArrayValue(value,''))}>添加一项</Button>
    </div></details>
  </div>;
  if(value&&typeof value==='object')return <div className="structured-nested"><details open><summary>{valueKind(value)}</summary><StructuredFields value={value as ValueRecord} disabled={disabled} onChange={onChange}/></details></div>;
  const currentType=value===null?'null':typeof value;
  return <div className="structured-primitive">
    <Select aria-label="值类型" size="small" disabled={disabled} value={currentType} options={[{value:'string',label:'文本'},{value:'number',label:'数字'},{value:'boolean',label:'是/否'},{value:'null',label:'空值'},{value:'object',label:'对象'},{value:'array',label:'列表'}]} onChange={type=>onChange(emptyForType(type))}/>
    {currentType==='string'&&<Input size="small" disabled={disabled} value={value as string} onChange={event=>onChange(event.target.value)} placeholder="填写文本或变量，如 {{search.text}}"/>}
    {currentType==='number'&&<InputNumber size="small" disabled={disabled} value={value as number} onChange={next=>{if(next!==null)onChange(next);}}/>}
    {currentType==='boolean'&&<Checkbox disabled={disabled} checked={value as boolean} onChange={event=>onChange(event.target.checked)}>{value?'是':'否'}</Checkbox>}
    {currentType==='null'&&<span className="readable-null">空值</span>}
    {currentType==='object'&&<EditableValue value={value} disabled={disabled} depth={depth+1} onChange={onChange}/>}
  </div>;
}

export function StructuredValue({value,onChange,disabled=false}:{value:unknown;onChange:(value:unknown)=>void;disabled?:boolean}){
  return <EditableValue value={value} onChange={onChange} disabled={disabled}/>;
}

export function StructuredFields({value,onChange,disabled=false,label='参数'}:StructuredFieldsProps){
  const [newKey,setNewKey]=useState('');
  const entries=Object.entries(value||{});
  return <div className="structured-fields">
    {label&&<div className="structured-fields-label">{label}</div>}
    {entries.length?<div className="structured-fields-list">{entries.map(([key,item])=><div className="structured-field-row" key={key}>
      <FieldNameInput value={key} disabled={disabled} onCommit={nextKey=>{const next=renameRecordKey(value,key,nextKey);if(next===value)return false;onChange(next);}}/>
      <EditableValue value={item} disabled={disabled} onChange={next=>onChange(setRecordValue(value,key,next))}/>
      <Button aria-label={`删除字段 ${key}`} size="small" type="text" danger disabled={disabled} icon={<DeleteOutlined/>} onClick={()=>onChange(removeRecordKey(value,key))}/>
    </div>)}</div>:<p className="structured-empty">还没有字段。添加一项即可开始。</p>}
    <Space.Compact className="structured-add-row"><Input aria-label="新字段名称" size="small" disabled={disabled} value={newKey} onChange={event=>setNewKey(event.target.value)} onPressEnter={()=>{if(newKey.trim()&&!Object.prototype.hasOwnProperty.call(value,newKey.trim())){onChange(setRecordValue(value,newKey.trim(),''));setNewKey('');}}} placeholder="新字段名称"/><Button size="small" disabled={disabled||!newKey.trim()||Object.prototype.hasOwnProperty.call(value,newKey.trim())} icon={<PlusOutlined/>} onClick={()=>{onChange(setRecordValue(value,newKey.trim(),''));setNewKey('');}}>添加字段</Button></Space.Compact>
  </div>;
}

interface TypedParametersProps {
  schema:Record<string,unknown>;
  value:ValueRecord;
  onChange:(value:ValueRecord)=>void;
  disabled?:boolean;
}

function schemaType(schema:Record<string,unknown>,value:unknown):string{
  const declaredTypes=Array.isArray(schema.type)?schema.type.filter((type):type is string=>typeof type==='string'):typeof schema.type==='string'?[schema.type]:[];
  if(value===null&&declaredTypes.includes('null'))return 'null';
  const declared=declaredTypes.find(type=>type!=='null');
  if(typeof declared==='string')return declared;
  if(Array.isArray(schema.enum))return 'enum';
  if(value!==null&&Array.isArray(value))return 'array';
  if(value&&typeof value==='object')return 'object';
  if(typeof value==='boolean'||typeof value==='number'||typeof value==='string')return typeof value;
  return 'string';
}

function enumOptionLabel(value:unknown){
  if(typeof value==='string'){
    const translated=statusNames[value]||kindNames[value]||({indexed_patches:'按原 Word 段落修订',new_report:'新建报告',docx:'Word 文档',pdf:'PDF 文档',md:'Markdown 文档',txt:'纯文本'} as Record<string,string>)[value];
    const readable=translated||value.replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
    return <span className="schema-enum-label">{readable}{readable!==value&&<small> · {value}</small>}</span>;
  }
  if(typeof value==='boolean')return value?'是':'否';
  if(value===null)return '空值';
  if(typeof value==='object')return <ReadableValue value={value} compact/>;
  return String(value);
}

function objectValue(value:unknown):ValueRecord{return value&&typeof value==='object'&&!Array.isArray(value)?value as ValueRecord:{};}

function SchemaObject({schema,value,onChange,disabled=false,depth=0}:{schema:Record<string,unknown>;value:ValueRecord;onChange:(value:ValueRecord)=>void;disabled?:boolean;depth?:number}){
  const properties=objectValue(schema.properties),fields=schemaFieldDefinitions(schema);
  const extras=Object.fromEntries(Object.entries(value).filter(([key])=>!Object.prototype.hasOwnProperty.call(properties,key)));
  return <div className="schema-object">
    {fields.map(({name,schema:fieldSchema,required})=><SchemaField key={name} name={name} schema={fieldSchema} value={value[name]} required={required} disabled={disabled} depth={depth+1} onChange={next=>onChange(setRecordValue(value,name,next))}/>)}
    {Object.keys(extras).length>0&&<details className="schema-extras" open><summary>其他已有参数 · {Object.keys(extras).length}</summary><p>这些字段不在当前工具说明中，仍按原值保留；可查看或编辑。</p><StructuredFields value={extras} disabled={disabled} label="" onChange={next=>{const kept=Object.fromEntries(Object.entries(value).filter(([key])=>Object.prototype.hasOwnProperty.call(properties,key)));onChange({...kept,...next});}}/></details>}
    {Object.keys(extras).length===0&&schema.additionalProperties!==false&&<details className="schema-extras"><summary>添加其他参数</summary><p>工具说明未列出的可选字段会原样发送。</p><StructuredFields value={extras} disabled={disabled} label="" onChange={next=>onChange({...value,...next})}/></details>}
    {!fields.length&&!Object.keys(extras).length&&schema.additionalProperties===false&&<p className="structured-empty">此工具没有参数字段。</p>}
  </div>;
}

function SchemaField({name,schema,value,onChange,required=false,disabled=false,depth=0}:{name:string;schema:Record<string,unknown>;value:unknown;onChange:(value:unknown)=>void;required?:boolean;disabled?:boolean;depth?:number}){
  const type=schemaType(schema,value),description=typeof schema.description==='string'?schema.description:undefined;
  if(depth>8)return <label className="schema-field"><span>{name}{required&&<b> *</b>}</span><ReadableValue value={value} emptyLabel="尚未填写"/></label>;
  if(Array.isArray(schema.enum)){
    const options=[...schema.enum];if(value!==undefined&&!options.some(option=>Object.is(option,value)))options.unshift(value);
    return <label className="schema-field"><span>{name}{required&&<b> *</b>}</span>{description&&<small>{description}</small>}<Select allowClear disabled={disabled} value={value===undefined?undefined:JSON.stringify(value)} options={options.map(option=>({value:JSON.stringify(option),label:enumOptionLabel(option)}))} onChange={encoded=>{if(encoded===undefined)onChange(undefined);else{try{onChange(JSON.parse(encoded));}catch{onChange(encoded);}}}} placeholder="选择一项"/></label>;
  }
  if(type==='object'){
    const object=objectValue(value);
    return <section className="schema-field schema-composite"><div className="schema-field-heading"><strong>{name}{required&&<b> *</b>}</strong><span>对象</span></div>{description&&<small>{description}</small>}
      {value!==undefined&&(value===null||typeof value!=='object'||Array.isArray(value))&&<div className="schema-mismatch"><ReadableValue value={value}/><Button size="small" disabled={disabled} onClick={()=>onChange({})}>改为空对象</Button></div>}
      {(value===undefined||value!==null&&typeof value==='object'&&!Array.isArray(value))&&<SchemaObject schema={schema} value={object} disabled={disabled} depth={depth} onChange={onChange as (value:ValueRecord)=>void}/>}
    </section>;
  }
  if(type==='array'){
    const items=Array.isArray(value)?value:[],itemSchema=objectValue(schema.items),canEdit=value===undefined||Array.isArray(value);
    return <section className="schema-field schema-composite"><div className="schema-field-heading"><strong>{name}{required&&<b> *</b>}</strong><span>列表 · {items.length} 项</span></div>{description&&<small>{description}</small>}
      {!canEdit&&<div className="schema-mismatch"><ReadableValue value={value}/><Button size="small" disabled={disabled} onClick={()=>onChange([])}>改为空列表</Button></div>}
      {canEdit&&<div className="schema-array-list">{items.map((item,index)=><div className="schema-array-row" key={index}><SchemaField name={`第 ${index+1} 项`} schema={itemSchema} value={item} disabled={disabled} depth={depth+1} onChange={next=>onChange(items.map((current,i)=>i===index?next:current))}/><Button aria-label={`删除第 ${index+1} 项`} size="small" type="text" danger disabled={disabled} icon={<DeleteOutlined/>} onClick={()=>onChange(removeArrayValue(items,index))}/></div>)}<Button size="small" disabled={disabled} icon={<PlusOutlined/>} onClick={()=>onChange(appendArrayValue(items,defaultForSchema(itemSchema)))}>添加一项</Button></div>}
    </section>;
  }
  const primitiveType=['string','integer','number','boolean','null'].includes(type);
  const matches=type==='string'?typeof value==='string':type==='integer'?typeof value==='number'&&Number.isInteger(value):type==='number'?typeof value==='number':type==='boolean'?typeof value==='boolean':value===null;
  if(value!==undefined&&primitiveType&&!matches)return <section className="schema-field schema-composite"><div className="schema-field-heading"><strong>{name}{required&&<b> *</b>}</strong><span>工具要求：{type==='integer'?'整数':type==='number'?'数字':type==='boolean'?'是/否':type==='null'?'空值':'文本'}</span></div>{description&&<small>{description}</small>}<div className="schema-mismatch"><ReadableValue value={value}/><Button size="small" disabled={disabled} onClick={()=>onChange(defaultForSchema(schema))}>按工具说明转换</Button></div></section>;
  return <label className="schema-field"><span>{name}{required&&<b> *</b>}{typeof schema.type==='string'&&<small className="schema-type">{schema.type==='integer'?'整数':schema.type==='number'?'数字':schema.type==='boolean'?'是/否':'文本'}</small>}</span>{description&&<small>{description}</small>}
    {type==='string'&&<Input disabled={disabled} value={typeof value==='string'?value:''} onChange={event=>onChange(event.target.value)} placeholder={required?'必填文本':'选填'}/>}
    {type==='integer'&&<InputNumber disabled={disabled} precision={0} style={{width:'100%'}} value={typeof value==='number'?value:undefined} onChange={next=>{if(next!==null)onChange(next);}} placeholder={required?'必填整数':'选填'}/>}
    {type==='number'&&<InputNumber disabled={disabled} style={{width:'100%'}} value={typeof value==='number'?value:undefined} onChange={next=>{if(next!==null)onChange(next);}} placeholder={required?'必填数字':'选填'}/>}
    {type==='boolean'&&<Checkbox disabled={disabled} checked={typeof value==='boolean'?value:undefined} onChange={event=>onChange(event.target.checked)}>{value===true?'是':value===false?'否':'未选择'}</Checkbox>}
    {type==='null'&&<span className="readable-null">空值</span>}
    {!['string','integer','number','boolean','null','object','array','enum'].includes(type)&&<EditableValue value={value} disabled={disabled} onChange={onChange}/>}
  </label>;
}

export function TypedParameters({schema,value,onChange,disabled=false}:TypedParametersProps){
  if(hasUnsupportedSchema(schema))return <div className="schema-unsupported"><p>此工具使用了表单暂不支持的高级结构，以下保留完整参数值并提供通用字段编辑。</p><StructuredFields value={value||{}} disabled={disabled} onChange={onChange}/></div>;
  const rootSchema=schemaType(schema,value)==='object'||schema.properties?'object':schemaType(schema,value);
  if(rootSchema==='object')return <SchemaObject schema={schema} value={value||{}} onChange={onChange} disabled={disabled}/>;
  return <div className="schema-unsupported"><p>参数说明的根结构不是对象；以下通用编辑保留当前参数字段。</p><StructuredFields value={value||{}} disabled={disabled} onChange={onChange}/></div>;
}
