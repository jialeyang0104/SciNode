import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {KeyboardEvent} from 'react';
import {Alert,Button,Input,Modal,Spin,Tooltip} from 'antd';
import {ArrowLeftOutlined,ArrowRightOutlined,ArrowUpOutlined,DesktopOutlined,FileOutlined,FilePdfOutlined,FileTextOutlined,FileWordOutlined,FolderOutlined,HomeOutlined,ReloadOutlined,SearchOutlined} from '@ant-design/icons';
import {errorText,research} from './api';
import type {AssistantLocalFileEntry,AssistantLocalFileListing} from './types';
import './LocalFilePicker.css';

interface LocalFilePickerProps {
 open:boolean;
 onClose:()=>void;
 onSelect:(path:string)=>Promise<void>;
 selecting?:boolean;
}

const MAX_FILE_BYTES=20*1024*1024;
const SUPPORTED_EXTENSIONS=new Set(['docx','pdf','txt','md','csv','json']);

function leafName(path:string){const parts=path.replace(/[\\/]+$/,'').split(/[\\/]/).filter(Boolean);return parts[parts.length-1]||path;}
function joinPath(parent:string,name:string){return `${parent}${parent.includes('\\')?'\\':'/'}${name}`;}
function extension(name:string){const parts=name.split('.');return name.includes('.')?parts[parts.length-1].toLocaleLowerCase():'';}
function formatSize(size?:number){
 if(size===undefined)return '大小未知';
 if(size<1024)return `${size} B`;
 if(size<1024*1024)return `${(size/1024).toFixed(1)} KB`;
 return `${(size/1024/1024).toFixed(2)} MB`;
}
function FileGlyph({name}:{name:string}){
 const ext=extension(name);
 if(ext==='pdf')return <span className="lfp-file-glyph lfp-pdf"><FilePdfOutlined/></span>;
 if(ext==='docx')return <span className="lfp-file-glyph lfp-docx"><FileWordOutlined/></span>;
 if(ext==='txt'||ext==='md')return <span className="lfp-file-glyph lfp-text"><FileTextOutlined/></span>;
 return <span className={`lfp-file-glyph lfp-${ext||'other'}`} aria-hidden="true">{ext?ext.slice(0,4).toUpperCase():<FileOutlined/>}</span>;
}

export default function LocalFilePicker({open,onClose,onSelect,selecting=false}:LocalFilePickerProps){
 const requestGeneration=useRef(0),columnScrollRef=useRef<HTMLDivElement>(null);
 const [columns,setColumns]=useState<AssistantLocalFileListing[]>([]),[selectedDirectories,setSelectedDirectories]=useState<string[]>([]),[selectedFile,setSelectedFile]=useState<AssistantLocalFileEntry>();
 const [desktopPath,setDesktopPath]=useState(''),[homePath,setHomePath]=useState(''),[filter,setFilter]=useState(''),[goToOpen,setGoToOpen]=useState(false),[goPath,setGoPath]=useState('');
 const [loadingColumn,setLoadingColumn]=useState<number>(),[loadingLabel,setLoadingLabel]=useState('正在读取桌面目录'),[error,setError]=useState(''),[importError,setImportError]=useState(''),[focusedIndices,setFocusedIndices]=useState<Record<number,number>>({}),[activeColumn,setActiveColumn]=useState(0),[importing,setImporting]=useState(false);

 const loadRoot=useCallback(async()=>{
  const token=++requestGeneration.current;setColumns([]);setSelectedDirectories([]);setSelectedFile(undefined);setFocusedIndices({});setLoadingColumn(0);setLoadingLabel('正在读取桌面目录');setError('');setImportError('');setFilter('');setGoPath('');
  try{
   const listing=await research.assistantLocalFiles();if(token!==requestGeneration.current)return;
   setColumns([listing]);setDesktopPath(listing.path);setHomePath(listing.parentPath||'');setGoPath(listing.path);setActiveColumn(0);
  }catch(reason){if(token===requestGeneration.current)setError(errorText(reason));}
  finally{if(token===requestGeneration.current)setLoadingColumn(undefined);}
 },[]);

 useEffect(()=>{
  if(!open){requestGeneration.current++;setColumns([]);setSelectedDirectories([]);setSelectedFile(undefined);setLoadingColumn(undefined);setLoadingLabel('正在读取桌面目录');setError('');setImportError('');setImporting(false);return;}
  void loadRoot();
  const generation=requestGeneration;
  return()=>{generation.current++;};
 },[open,loadRoot]);

 const latestListing=columns[columns.length-1];
 const latestPath=latestListing?.path;
 useEffect(()=>{if(latestPath)setGoPath(latestPath);},[latestPath]);
 useEffect(()=>{const pane=columnScrollRef.current;if(pane)pane.scrollTo({left:pane.scrollWidth,behavior:'smooth'});},[columns.length,loadingColumn]);
 const closePicker=()=>{requestGeneration.current++;setLoadingColumn(undefined);setImporting(false);onClose();};

 const loadPath=useCallback(async(path:string)=>{
  const token=++requestGeneration.current;setLoadingColumn(0);setLoadingLabel(`正在读取 ${leafName(path)}`);setError('');setImportError('');setFilter('');setSelectedFile(undefined);setSelectedDirectories([]);setFocusedIndices({});setColumns([]);
  try{const listing=await research.assistantLocalFiles(path);if(token!==requestGeneration.current)return;setColumns([listing]);setGoPath(listing.path);setActiveColumn(0);}
  catch(reason){if(token===requestGeneration.current)setError(errorText(reason));}
  finally{if(token===requestGeneration.current)setLoadingColumn(undefined);}
 },[]);

 const openDirectory=useCallback(async(entry:AssistantLocalFileEntry,columnIndex:number)=>{
  const token=++requestGeneration.current;setLoadingLabel(`正在读取 ${entry.name}`);setError('');setImportError('');setSelectedFile(undefined);setFilter('');setActiveColumn(columnIndex);
  setSelectedDirectories(current=>[...current.slice(0,columnIndex),entry.path]);
  setColumns(current=>current.slice(0,columnIndex+1));setLoadingColumn(columnIndex);
  try{const listing=await research.assistantLocalFiles(entry.path);if(token!==requestGeneration.current)return;setColumns(current=>[...current.slice(0,columnIndex+1),listing]);setGoPath(listing.path);setActiveColumn(columnIndex+1);}
  catch(reason){if(token===requestGeneration.current)setError(errorText(reason));}
  finally{if(token===requestGeneration.current)setLoadingColumn(undefined);}
 },[]);

 const refresh=useCallback(async()=>{
  const current=columns[columns.length-1];if(!current){void loadRoot();return;}
  const token=++requestGeneration.current,index=columns.length-1;setLoadingColumn(index);setLoadingLabel(`正在刷新 ${leafName(current.path)}`);setError('');setImportError('');
  try{
   const listing=await research.assistantLocalFiles(current.path);if(token!==requestGeneration.current)return;
   setColumns(items=>items.map((item,itemIndex)=>itemIndex===index?listing:item));
   if(selectedFile&&!listing.entries.some(item=>item.path===selectedFile.path))setSelectedFile(undefined);
  }catch(reason){if(token===requestGeneration.current)setError(errorText(reason));}
  finally{if(token===requestGeneration.current)setLoadingColumn(undefined);}
 },[columns,loadRoot,selectedFile]);

 const visibleEntries=useMemo(()=>{
  if(!latestListing)return [];
  const term=filter.trim().toLocaleLowerCase();
  return latestListing.entries.filter(entry=>!term||entry.name.toLocaleLowerCase().includes(term));
 },[latestListing,filter]);
 const currentFolders=latestListing?.entries.filter(entry=>entry.directory).length||0;
 const shortcuts=[
  {name:'桌面',path:desktopPath,icon:<DesktopOutlined/>},
  {name:'主目录',path:homePath,icon:<HomeOutlined/>},
  {name:'文稿',path:homePath?joinPath(homePath,'Documents'):'',icon:<FileTextOutlined/>},
  {name:'下载',path:homePath?joinPath(homePath,'Downloads'):'',icon:<ArrowDownIcon/>},
 ].filter(item=>item.path);

 const selectBreadcrumb=(index:number)=>{
  requestGeneration.current++;setColumns(current=>current.slice(0,index+1));setSelectedDirectories(current=>current.slice(0,index));setSelectedFile(undefined);setLoadingColumn(undefined);setError('');setImportError('');setFilter('');setActiveColumn(index);
 };
 const goUp=()=>{
  if(columns.length>1){selectBreadcrumb(columns.length-2);return;}
  const parent=latestListing?.parentPath;if(parent)void loadPath(parent);
 };
 const back=()=>{
  if(columns.length>1)selectBreadcrumb(columns.length-2);
  else if(latestListing?.parentPath)void loadPath(latestListing.parentPath);
 };
 const refreshRoot=()=>void loadRoot();
 const canSelect=(entry:AssistantLocalFileEntry)=>{
  const ext=extension(entry.name);
  return !entry.directory&&SUPPORTED_EXTENSIONS.has(ext)&&(entry.size===undefined||entry.size<=MAX_FILE_BYTES);
 };
 const selectFile=(entry:AssistantLocalFileEntry,columnIndex:number)=>{
  const truncatesDescendants=columnIndex<columns.length-1;
  requestGeneration.current++;setLoadingColumn(undefined);setColumns(current=>current.slice(0,columnIndex+1));setSelectedDirectories(current=>current.slice(0,columnIndex));setSelectedFile(entry);setImportError('');if(truncatesDescendants)setFilter('');setActiveColumn(columnIndex);
 };
 const confirmSelection=async()=>{
  if(!selectedFile||!canSelect(selectedFile)||importing||selecting)return;
  const token=requestGeneration.current;setImporting(true);setImportError('');
  try{await onSelect(selectedFile.path);if(token===requestGeneration.current)closePicker();}
  catch(reason){if(token===requestGeneration.current)setImportError(errorText(reason));}
  finally{if(token===requestGeneration.current)setImporting(false);}
 };

 const focusEntry=(column:number,index:number)=>{
  setActiveColumn(column);setFocusedIndices(current=>({...current,[column]:index}));
  requestAnimationFrame(()=>{
   const item=columnScrollRef.current?.querySelector<HTMLButtonElement>(`[data-picker-column="${column}"] [data-entry-index="${index}"]`);
   item?.focus();item?.scrollIntoView({block:'nearest'});
  });
 };
 const onColumnKeyDown=(event:KeyboardEvent<HTMLDivElement>,columnIndex:number,entries:AssistantLocalFileEntry[])=>{
  if(!entries.length)return;
  const focused=(document.activeElement as HTMLElement|null)?.closest<HTMLElement>('[data-entry-index]');
  const requestedIndex=Number(focused?.dataset.entryIndex??focusedIndices[columnIndex]??0),currentIndex=Math.max(0,Math.min(entries.length-1,requestedIndex));
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   event.preventDefault();const next=Math.max(0,Math.min(entries.length-1,currentIndex+(event.key==='ArrowDown'?1:-1)));focusEntry(columnIndex,next);return;
  }
  if(event.key==='ArrowRight'||event.key==='Enter'){
   event.preventDefault();const entry=entries[currentIndex];if(entry?.directory)void openDirectory(entry,columnIndex);else if(entry)selectFile(entry,columnIndex);return;
  }
  if(event.key==='ArrowLeft'&&columnIndex>0){
   event.preventDefault();const parentPath=selectedDirectories[columnIndex-1];const parentEntry=columns[columnIndex-1]?.entries.find(entry=>entry.path===parentPath);const index=columns[columnIndex-1]?.entries.findIndex(entry=>entry.path===parentPath)??-1;if(parentEntry&&index>=0)focusEntry(columnIndex-1,index);
  }
 };

 const unsupportedMessage=selectedFile&& !SUPPORTED_EXTENSIONS.has(extension(selectedFile.name))?'支持 DOCX、PDF、TXT、MD、CSV、JSON 格式。':selectedFile&&selectedFile.size!==undefined&&selectedFile.size>MAX_FILE_BYTES?'文件超过20MB，请选择较小的文件。':'';
 const selectedExtension=selectedFile?extension(selectedFile.name).toUpperCase():'文件';
 const selectedLocation=selectedFile?columns.find(listing=>listing.entries.some(entry=>entry.path===selectedFile.path))?.path:'';
 const navigationBusy=loadingColumn!==undefined||importing||selecting;

 return <Modal className="local-file-picker" open={open} width="min(1120px, 94vw)" centered footer={null} closable={false} onCancel={closePicker} destroyOnHidden>
  <div className="lfp-frame">
   <header className="lfp-toolbar">
    <div className="lfp-window-mark"><FolderOutlined/></div>
    <div className="lfp-title"><strong>选择本机文件</strong><small>浏览目录并核对文件信息</small></div>
    <div className="lfp-toolbar-buttons">
     <Tooltip title="返回"><Button aria-label="返回上级目录" icon={<ArrowLeftOutlined/>} disabled={!latestListing?.parentPath||navigationBusy} onClick={back}/></Tooltip>
     <Tooltip title="向上"><Button aria-label="打开父目录" icon={<ArrowUpOutlined/>} disabled={!latestListing?.parentPath||navigationBusy} onClick={goUp}/></Tooltip>
     <Tooltip title="回到桌面"><Button aria-label="回到桌面" icon={<DesktopOutlined/>} disabled={!desktopPath||navigationBusy} onClick={refreshRoot}/></Tooltip>
     <Tooltip title="刷新当前目录"><Button aria-label="刷新当前目录" icon={<ReloadOutlined/>} disabled={navigationBusy} onClick={()=>void refresh()}/></Tooltip>
    </div>
    <Button className="lfp-close" aria-label="关闭文件选择器" type="text" onClick={closePicker}>×</Button>
   </header>

   <div className={`lfp-goto ${goToOpen?'expanded':''}`}>
     <Button className="lfp-goto-toggle" type="text" disabled={navigationBusy} onClick={()=>setGoToOpen(value=>!value)}>{goToOpen?'收起路径输入':'前往文件夹'}</Button>
     {goToOpen&&<div className="lfp-goto-input"><Input value={goPath} disabled={navigationBusy} onChange={event=>setGoPath(event.target.value)} onPressEnter={()=>goPath.trim()&&!navigationBusy&&void loadPath(goPath.trim())} aria-label="输入本机目录路径" placeholder="输入目录路径"/><Button type="primary" icon={<ArrowRightOutlined/>} disabled={!goPath.trim()||navigationBusy} onClick={()=>void loadPath(goPath.trim())}>前往</Button></div>}
   </div>

   <nav className="lfp-breadcrumbs" aria-label="当前路径">
    {columns.map((listing,index)=><span className="lfp-crumb-wrap" key={`${listing.path}-${index}`}>
     {index>0&&<span className="lfp-crumb-divider">›</span>}
     <button type="button" className={index===columns.length-1?'current':''} title={listing.path} onClick={()=>selectBreadcrumb(index)}>{index===0&&listing.path===desktopPath?'桌面':leafName(listing.path)}</button>
    </span>)}
    {latestListing&&<span className="lfp-path-hint" title={latestListing.path}>{latestListing.path}</span>}
   </nav>

   {error&&<Alert className="lfp-error" type="error" showIcon message="目录读取失败" description={error} closable onClose={()=>setError('')}/>}
   {importError&&<Alert className="lfp-error" type="error" showIcon message="文件添加失败" description={importError} closable onClose={()=>setImportError('')}/>}

   <div className="lfp-workspace">
    <aside className="lfp-sidebar" aria-label="常用位置">
     <span className="lfp-section-caption">常用位置</span>
     {shortcuts.map(item=><button type="button" key={item.name} className={columns[0]?.path===item.path?'active':''} disabled={navigationBusy} onClick={()=>void loadPath(item.path)}><span>{item.icon}</span><b>{item.name}</b></button>)}
     <div className="lfp-sidebar-note"><strong>文件范围</strong><span>支持 6 种常见格式</span><span>单个文件上限 20 MB</span></div>
    </aside>

    <section className="lfp-browser" aria-label="目录内容">
     <div className="lfp-browser-toolbar"><div><strong>{latestListing?leafName(latestListing.path):'正在打开桌面'}</strong><small>{latestListing?`${latestListing.entries.length} 项 · ${currentFolders} 个文件夹`:'本机目录'}</small></div><Input className="lfp-filter" prefix={<SearchOutlined/>} value={filter} onChange={event=>setFilter(event.target.value)} allowClear placeholder="筛选当前目录" aria-label="筛选当前目录" disabled={!latestListing||navigationBusy}/></div>
     <div className="lfp-columns" ref={columnScrollRef}>
      {!columns.length&&loadingColumn!==undefined&&<div className="lfp-loading-root"><Spin/><span>{loadingLabel}</span></div>}
      {columns.map((listing,columnIndex)=>{
       const entries=columnIndex===columns.length-1?visibleEntries:listing.entries;
       const folders=entries.filter(entry=>entry.directory),files=entries.filter(entry=>!entry.directory);
       const ordered=[...folders,...files];
       return <div className={`lfp-column ${activeColumn===columnIndex?'active-column':''}`} key={`${listing.path}-${columnIndex}`} data-picker-column={columnIndex} role="listbox" aria-label={`${leafName(listing.path)}中的项目`} tabIndex={0} onFocus={()=>setActiveColumn(columnIndex)} onKeyDown={event=>onColumnKeyDown(event,columnIndex,ordered)}>
        <div className="lfp-column-heading"><span title={listing.path}>{columnIndex===0&&listing.path===desktopPath?'桌面':leafName(listing.path)}</span><small>{entries.length}</small></div>
        <div className="lfp-column-scroll">
         {!!folders.length&&<><div className="lfp-group-title">文件夹 <small>{folders.length}</small></div>{folders.map(entry=>{
          const entryIndex=ordered.indexOf(entry),chosen=selectedDirectories[columnIndex]===entry.path;
          return <button key={entry.path} type="button" role="option" aria-selected={chosen} tabIndex={-1} disabled={navigationBusy} data-entry-index={entryIndex} className={`lfp-entry lfp-folder ${chosen?'selected':''}`} title={entry.name} onFocus={()=>{setFocusedIndices(current=>({...current,[columnIndex]:entryIndex}));setActiveColumn(columnIndex);}} onClick={()=>void openDirectory(entry,columnIndex)}><span className="lfp-entry-icon"><FolderOutlined/></span><span className="lfp-entry-name">{entry.name}</span><ArrowRightOutlined className="lfp-entry-chevron"/></button>;
         })}</>}
         {!!files.length&&<><div className="lfp-group-title">文稿 <small>{files.length}</small></div>{files.map(entry=>{
          const entryIndex=ordered.indexOf(entry),chosen=selectedFile?.path===entry.path;
          return <button key={entry.path} type="button" role="option" aria-selected={chosen} tabIndex={-1} disabled={navigationBusy} data-entry-index={entryIndex} className={`lfp-entry lfp-document ${chosen?'selected':''}`} title={entry.name} onFocus={()=>{setFocusedIndices(current=>({...current,[columnIndex]:entryIndex}));setActiveColumn(columnIndex);}} onClick={()=>selectFile(entry,columnIndex)}><FileGlyph name={entry.name}/><span className="lfp-entry-name">{entry.name}</span></button>;
         })}</>}
         {!entries.length&&<div className="lfp-empty-column">{filter?'没有匹配项目':'此文件夹为空'}</div>}
        </div>
       </div>;
      })}
      {loadingColumn!==undefined&&columns.length>0&&loadingColumn===columns.length-1&&<div className="lfp-column lfp-pending-column"><div className="lfp-column-heading">正在打开</div><div className="lfp-pending-loading"><Spin size="small"/><span>{loadingLabel}</span></div></div>}
     </div>
    </section>

    <aside className={`lfp-preview ${selectedFile?'has-selection':''}`} aria-label="文件信息">
     {selectedFile?<>
      <div className="lfp-preview-icon"><FileGlyph name={selectedFile.name}/></div>
      <span className="lfp-preview-kicker">文件信息</span>
      <h2 title={selectedFile.name}>{selectedFile.name}</h2>
      <span className="lfp-type-pill">{selectedExtension}</span>
      <dl><div><dt>大小</dt><dd>{formatSize(selectedFile.size)}</dd></div><div><dt>位置</dt><dd title={selectedLocation}>{selectedLocation?leafName(selectedLocation):'本机'}</dd></div></dl>
      <div className={`lfp-support ${unsupportedMessage?'unsupported':''}`}>{unsupportedMessage||'支持添加到对话'}</div>
      <p className="lfp-preview-path" title={selectedFile.path}>{selectedFile.path}</p>
     </>:<div className="lfp-preview-empty"><span className="lfp-preview-empty-icon"><FileOutlined/></span><strong>选择一个文件</strong><p>文件信息会显示在这里。添加前可核对格式、大小和位置。</p></div>}
    </aside>
   </div>

   <footer className="lfp-footer">
    <p>选择文件后，点击“加入对话”以读取并添加。支持 DOCX、PDF、TXT、MD、CSV、JSON；每个会话最多5个附件。</p>
    <div><Button onClick={closePicker}>取消</Button><Button type="primary" loading={importing||selecting} disabled={!selectedFile||!!unsupportedMessage||loadingColumn!==undefined} onClick={()=>void confirmSelection()}>加入对话</Button></div>
   </footer>
  </div>
 </Modal>;
}

function ArrowDownIcon(){return <span className="lfp-download-icon" aria-hidden="true">↓</span>;}
