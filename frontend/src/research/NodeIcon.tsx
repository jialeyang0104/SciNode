import {ApiOutlined,CheckSquareOutlined,CodeOutlined,FileDoneOutlined,FileTextOutlined,FolderOpenOutlined,FormOutlined,RobotOutlined,SafetyCertificateOutlined,SearchOutlined} from '@ant-design/icons';
import type {Kind} from './types';

const icons={input:FormOutlined,document:FileTextOutlined,llm:RobotOutlined,pubmed:SearchOutlined,
  python:CodeOutlined,r:CodeOutlined,mcp:ApiOutlined,check:SafetyCertificateOutlined,
  approve:CheckSquareOutlined,export:FileDoneOutlined,package:FolderOpenOutlined};

export default function NodeIcon({kind}:{kind:Kind}){
  const Icon=icons[kind];
  return <Icon aria-hidden="true"/>;
}
