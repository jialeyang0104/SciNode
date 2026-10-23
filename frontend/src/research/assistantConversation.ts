import type {AssistantChatMessage,AssistantDraft} from './types';

/** Add the working draft to request context without rewriting any historical reply. */
export function assistantRequestMessages(messages:AssistantChatMessage[],draft?:AssistantDraft,limit=20):Pick<AssistantChatMessage,'role'|'content'|'contextCards'>[]{
 const latest=messages.reduce((index,message,current)=>message.role==='assistant'?current:index,-1);
 const start=Math.max(0,messages.length-limit);
 return messages.slice(start).map((message,index)=>{
  if(message.role==='user')return {role:message.role,content:message.content,...(message.contextCards?.length?{contextCards:message.contextCards}:{})};
  const context={
   ...(message.planning?{publicPlanning:message.planning}:{}),
   ...(message.questions?.length?{questions:message.questions}:{}),
   ...(start+index===latest&&draft?{draft}:{}),
  };
  return {role:message.role,content:Object.keys(context).length?`${message.content}\n\n[助手公开摘要、待确认事项及当前完整草案]\n${JSON.stringify(context)}`:message.content};
 });
}
