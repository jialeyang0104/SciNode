import {useState} from 'react';
import {Button,Dropdown,Empty,Input,Modal,Select,Spin,Tag} from 'antd';
import {AppstoreOutlined,ArrowRightOutlined,ClockCircleOutlined,FolderOpenOutlined,InboxOutlined,LockOutlined,MoreOutlined,PlusOutlined,SearchOutlined} from '@ant-design/icons';
import {type Project,type Run,statusName,statusColor} from './types';

interface Props {loading:boolean;projects:Project[];latest:Record<string,Run|undefined>;frozenTotal:number;open:(p:Project)=>void;create:()=>void;settings:(p:Project)=>void;lifecycle:(p:Project,state:string)=>void}

function nextAction(run:Run|undefined){
  if(!run)return '导入资料，开始配置你的研究流程';
  if(run.status==='WAITING_APPROVAL')return `待确认：${run.nodeResults[run.currentNodeId||'']?.summary||'检查材料并给出意见'}`;
  if(run.error)return `需要处理：${run.error}`;
  if(run.status==='SUCCESS')return run.frozen?'成果已冻结，可查看或创建新版本':'运行已完成，检查成果后可冻结';
  if(run.status==='RUNNING'||run.status==='QUEUED')return `正在执行：${run.nodeResults[run.currentNodeId||'']?.label||'准备下一步'}`;
  if(run.status==='PAUSED')return '流程已暂停，可继续已确认的阶段';
  return '检查流程设置，创建一次新的运行';
}

export default function ProjectDashboard({loading,projects,latest,frozenTotal,open,create,settings,lifecycle}:Props){
  const [search,setSearch]=useState('');
  const [state,setState]=useState('ACTIVE');
  const [category,setCategory]=useState<string>();
  const [sort,setSort]=useState('updated');
  const stateProjects=projects.filter(p=>(p.lifecycle||'ACTIVE')===state);
  const groups=Array.from(new Set(stateProjects.map(p=>p.category||'其他科研'))).sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const visible=stateProjects.filter(p=>(!category||(p.category||'其他科研')===category)&&`${p.name} ${p.description||''}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'zh-CN'):new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime());
  const waiting=Object.values(latest).filter(r=>r?.status==='WAITING_APPROVAL').length;
  const changeState=(next:string)=>{setState(next);setCategory(undefined);};
  const menu=(p:Project)=>({items:[
    {key:'open',label:'打开项目'}, {key:'settings',label:'项目设置与 Agent 规则'},
    {key:'archive',label:state==='ARCHIVED'?'恢复到进行中':'归档项目'},
    {key:'trash',label:state==='TRASHED'?'恢复项目':'删除项目（移入回收站）',danger:state!=='TRASHED'},
  ],onClick:({key}:{key:string})=>{
    if(key==='open')open(p);
    else if(key==='settings')settings(p);
    else{
      const target=key==='archive'?(state==='ARCHIVED'?'ACTIVE':'ARCHIVED'):(state==='TRASHED'?'ACTIVE':'TRASHED');
      if(target==='TRASHED')Modal.confirm({title:`删除“${p.name}”？`,content:'项目移入回收站，输入文件、历史版本、运行记录和冻结成果保留，可随时恢复。',onOk:()=>lifecycle(p,target)});
      else lifecycle(p,target);
    }
  }});

  return <main className="science-dashboard" id="main-content">
    <aside className="dashboard-sidebar" aria-label="科研项目导航">
      <div className="dashboard-sidebar-heading"><AppstoreOutlined/><strong>我的工作空间</strong></div>
      <nav className="dashboard-state-nav" aria-label="项目状态">
        {[{value:'ACTIVE',label:'进行中',icon:<FolderOpenOutlined/>},{value:'ARCHIVED',label:'已归档',icon:<InboxOutlined/>},{value:'TRASHED',label:'回收站',icon:<InboxOutlined/>}].map(item=><button key={item.value} type="button" aria-pressed={state===item.value} onClick={()=>changeState(item.value)}>{item.icon}<span>{item.label}</span><small>{projects.filter(p=>(p.lifecycle||'ACTIVE')===item.value).length}</small></button>)}
      </nav>
      <div className="dashboard-category-heading">科研分类</div>
      <nav className="dashboard-category-nav" aria-label="科研分类">
        <button type="button" aria-pressed={!category} onClick={()=>setCategory(undefined)}><span>全部项目</span><small>{stateProjects.length}</small></button>
        {groups.map(group=><button type="button" key={group} aria-pressed={category===group} onClick={()=>setCategory(group)}><span>{group}</span><small>{stateProjects.filter(p=>(p.category||'其他科研')===group).length}</small></button>)}
      </nav>
      <div className="dashboard-sidebar-note"><LockOutlined/><span>保存每一步研究<br/><small>版本、审核与成果相互关联</small></span></div>
    </aside>
    <section className="dashboard-main" aria-label="项目概览">
      <div className="dashboard-title"><div><span className="eyebrow">YOUR RESEARCH, CONNECTED</span><h1>{category||'科研项目'}<span>{visible.length}</span></h1><p>从研究问题出发，让每一步进展清晰可见。</p></div><Button type="primary" size="large" icon={<PlusOutlined/>} onClick={create}>新建项目</Button></div>
      <div className="dashboard-stats" aria-label="科研概况">
        <div><FolderOpenOutlined/><span>进行中项目</span><strong>{loading?'—':projects.filter(p=>(p.lifecycle||'ACTIVE')==='ACTIVE').length}</strong></div>
        <div className={waiting?'has-pending':''}><ClockCircleOutlined/><span>等待确认</span><strong>{loading?'—':waiting}</strong></div>
        <div><LockOutlined/><span>已冻结成果</span><strong>{loading?'—':frozenTotal}</strong></div>
      </div>
      <div className="dashboard-filters">
        <Input prefix={<SearchOutlined/>} aria-label="搜索科研项目" placeholder="搜索项目名称或简介" allowClear value={search} onChange={e=>setSearch(e.target.value)}/>
        <Select aria-label="项目排序" value={sort} onChange={setSort} options={[{value:'updated',label:'最近更新'},{value:'name',label:'项目名称'}]}/>
        <span className="dashboard-list-label">{state==='ARCHIVED'?'已归档':state==='TRASHED'?'回收站':'当前版本'} · {visible.length} 个项目</span>
      </div>
      <div className="project-grid" aria-busy={loading}>
        {visible.map(p=>{
          const r=latest[p.id],total=r?.definition.nodes.length??p.nodes.length;
          const done=r?Object.values(r.nodeResults).filter(result=>result.status==='SUCCESS').length:0;
          const percent=total?Math.min(100,Math.round(done/total*100)):0;
          return <Dropdown key={p.id} menu={menu(p)} trigger={['contextMenu']}>
            <article className={`project-card ${r?.status==='WAITING_APPROVAL'?'project-card-waiting':''}`}>
              <div className="project-card-top"><span className="project-category"><FolderOpenOutlined/>{p.category||'其他科研'}</span><Dropdown menu={menu(p)} trigger={['click']}><Button type="text" aria-label={`管理项目 ${p.name}`} icon={<MoreOutlined/>}/></Dropdown></div>
              <button className="project-card-open" type="button" onClick={()=>open(p)} aria-label={`打开项目 ${p.name}`}><h2>{p.name}</h2><p className="project-description">{p.description||`${p.nodes.length} 个节点已就绪，在画布中规划、连接并调整你的科研任务。`}</p></button>
              <div className="project-card-meta"><Tag color={r?.frozen?'cyan':statusColor[r?.status||'']}>{r?.frozen?'成果已冻结':r?statusName[r.status]:'待启动'}</Tag><span>v{p.revision}</span><span>{p.nodes.length} 个节点</span><span>{p.files.length} 份资料</span></div>
              <div className="project-next" title={nextAction(r)}>{nextAction(r)}</div>
              <div className="project-progress" role="progressbar" aria-label={`${p.name}节点进度`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div style={{width:`${percent}%`}}/></div>
              <div className="project-card-bottom"><span>{done}/{total} 节点完成</span><time dateTime={p.updatedAt}>{new Date(p.updatedAt).toLocaleDateString()}</time><Button type="text" size="small" icon={<ArrowRightOutlined/>} aria-label={`进入 ${p.name}`} onClick={()=>open(p)}/></div>
            </article>
          </Dropdown>;
        })}
      </div>
      {loading&&<div className="dashboard-loading" role="status"><Spin/><span>正在读取项目与运行状态…</span></div>}
      {!loading&&!visible.length&&<div className="dashboard-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search||category?'没有匹配的项目，试试其他分类或关键词':'这里还没有项目'}/>{!search&&!category&&state==='ACTIVE'&&<Button icon={<PlusOutlined/>} onClick={create}>创建第一个科研项目</Button>}</div>}
      <p className="dashboard-help">项目仅显示当前版本。打开项目查看历史版本；右键或点击“⋯”管理项目。</p>
    </section>
  </main>;
}
