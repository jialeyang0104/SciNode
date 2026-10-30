import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './MarkdownPreview.css';

/** Read-only content, without raw HTML or automatic remote-image requests. */
export default function MarkdownPreview({text,className=''}:{text:string;className?:string}){
 return <div className={`markdown-preview ${className}`}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
  a:({children,...props})=><a {...props} target="_blank" rel="noopener noreferrer">{children}</a>,
  img:({alt,src})=><a href={src} target="_blank" rel="noopener noreferrer">{alt||'查看图片'}</a>,
 }}>{text}</ReactMarkdown></div>;
}
