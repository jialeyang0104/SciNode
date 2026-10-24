import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Form,Input,Button,message} from 'antd';
import {ArrowRightOutlined,LockOutlined,UserOutlined} from '@ant-design/icons';
import {login} from '../api/auth';
import {useAuthStore} from '../store/authStore';
import {errorText} from '../research/api';
import './LoginPage.css';

export default function LoginPage(){
 const [loading,setLoading]=useState(false),navigate=useNavigate();
 const {setAuth}=useAuthStore();
 const onFinish=async(values:{username:string;password:string})=>{setLoading(true);try{const result=await login(values);if(result.code!==200||!result.data)throw new Error(result.message||'登录失败');setAuth(result.data.token,result.data.refreshToken,result.data.user.username);navigate('/research');}catch(e){message.error(errorText(e));}finally{setLoading(false);}};
 return <main className="login-shell"><header className="login-topbar"><a className="login-brand" href="/login"><img src="/brand/scinode-icon.png" alt="SciNode 图标"/><span>SciNode</span></a><span className="login-edition">PERSONAL RESEARCH WORKSPACE</span></header>
 <div className="login-grid"><section className="login-story"><span className="login-kicker"><i/>为每一步研究，留下清晰脉络</span><h1>从一个问题，<br/>到一份<span>有据可循</span>的成果。</h1><p className="login-description">让思路、证据与行动在同一张画布上连接。<br/>规划研究，审阅过程，保存每一次进展。</p>
 <div className="research-illustration" aria-hidden="true"><div className="illustration-grid"/><svg viewBox="0 0 570 280" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="research-line" x1="0" x2="1"><stop stopColor="#c8c7eb"/><stop offset="1" stopColor="#7775b3"/></linearGradient></defs><path d="M96 147 C165 147 155 82 228 82 S320 82 355 136 S440 198 487 198"/><path d="M96 147 C165 147 157 220 228 220 S320 220 355 136"/><circle cx="96" cy="147" r="5"/><circle cx="228" cy="82" r="5"/><circle cx="228" cy="220" r="5"/><circle cx="355" cy="136" r="5"/><circle cx="487" cy="198" r="5"/></svg><div className="illustration-node illustration-source"><span>01</span><b>研究问题</b><small>QUESTION</small></div><div className="illustration-node illustration-evidence"><span>02</span><b>证据与资料</b><small>EVIDENCE</small></div><div className="illustration-node illustration-analysis"><span>03</span><b>分析与推演</b><small>ANALYSIS</small></div><div className="illustration-node illustration-review"><span>04</span><b>人工审核</b><small>REVIEW</small></div><div className="illustration-node illustration-output"><span>05</span><b>研究成果</b><small>OUTPUT</small></div></div>
 <div className="login-principles"><span>可视化工作流</span><i/><span>版本与来源记录</span><i/><span>人工审核与冻结</span></div></section>
 <section className="login-panel"><div className="login-panel-head"><img src="/brand/scinode-icon.png" alt=""/><span>YOUR RESEARCH, CONNECTED.</span></div><h2>欢迎回到 SciNode</h2><p>登录你的个人科研工作空间</p><Form name="login" onFinish={onFinish} layout="vertical" requiredMark={false} size="large"><Form.Item name="username" label="用户名" rules={[{required:true,message:'请输入用户名'}]}><Input prefix={<UserOutlined/>} placeholder="输入用户名" autoComplete="username"/></Form.Item><Form.Item name="password" label="密码" rules={[{required:true,message:'请输入密码'}]}><Input.Password prefix={<LockOutlined/>} placeholder="输入密码" autoComplete="current-password"/></Form.Item><Form.Item><Button type="primary" htmlType="submit" block loading={loading} icon={<ArrowRightOutlined/>} iconPlacement="end">进入工作空间</Button></Form.Item></Form><div className="login-panel-note"><LockOutlined/><span>项目、版本与运行记录保存在你的工作空间</span></div></section></div><footer className="login-footer"><span>SciNode v{__APP_VERSION__} · 个人科研 AI 工作流</span><span>Clarity in every step.</span></footer></main>;
}
