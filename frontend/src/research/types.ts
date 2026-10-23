import type { Node, Edge } from '@xyflow/react';
export type Kind = 'input'|'document'|'llm'|'pubmed'|'python'|'r'|'check'|'approve'|'export'|'package'|'mcp';
export interface ResearchData extends Record<string, unknown> {
  label: string; kind: Kind; description?: string; inputs?: Record<string,unknown>;runVisualState?:'idle'|'active'|'waiting'|'paused'|'failed'|'success';
  prompt?: string; script?: string; query?: string; limit?: number; timeout?: number; configId?: number; model?:string;
  mcpId?:number; arguments?:Record<string,unknown>;
  outputFields?: string[]; fileId?: string; format?: string; question?: string; text?: string; requiredFields?: string[];
  preview?: NodeResult; onAppend?: () => void;
}
export type ResearchNode = Node<ResearchData>;
export interface ProjectFile { id:string;name:string;path:string;size:number;sha256:string }
export interface AgentSettings {revision?:number;inheritGlobal?:boolean;agentRules?:string;skills?:string[];customSkills?:{name:string;content:string}[];mcpIds?:number[];defaultConfigId?:number;defaultModel?:string}
export interface Version {name?:string;category?:string;description?:string;settings?:AgentSettings;clinicalData?:boolean;revision:number;nodes:ResearchNode[];edges:Edge[];createdAt:string;note:string;sha256:string}
export interface Project {category?:string;description?:string;lifecycle?:'ACTIVE'|'ARCHIVED'|'TRASHED';settings?:AgentSettings;id:string;name:string;workspace:string;revision:number;clinicalData:boolean;nodes:ResearchNode[];edges:Edge[];files:ProjectFile[];versions:Version[];updatedAt:string}
export type AssistantChatRole='user'|'assistant';
export interface AssistantPlanning {summary:string;steps:string[];assumptions:string[];decisions:string[]}
export type AssistantQuestionTopic='research'|'nodes'|'layout'|'models'|'other';
export interface AssistantQuestion {id:string;topic:AssistantQuestionTopic;title:string;options:string[];recommended?:string}
export interface AssistantFileAttachment {id:string;name:string;size:number;sha256?:string;characters?:number;preview?:string;content?:string;error?:string}
export interface AssistantContextCard {id:string;type:'project_summary'|'run_error';title:string;content:string;truncated:boolean}
export interface AssistantChatMessage {role:AssistantChatRole;content:string;draft?:AssistantDraft;planning?:AssistantPlanning;questions?:AssistantQuestion[];repaired?:boolean;attachments?:AssistantFileAttachment[];contextCards?:AssistantContextCard[];selections?:AssistantSelection;toolResults?:AssistantMcpCallResult[]}
export interface AssistantDraft {name:string;category:string;description:string;clinicalData:boolean;settings?:AgentSettings;nodes:ResearchNode[];edges:Edge[]}
export interface AssistantSelection {skills:string[];mcpResultIds:string[]}
export type AssistantReasoningEffort='low'|'medium'|'high';
export interface AssistantChatRequest {configId:number;model?:string;reasoningEffort?:AssistantReasoningEffort;messages:Pick<AssistantChatMessage,'role'|'content'|'contextCards'>[];projectId?:string;requestId?:string;attachments?:string[];selections?:AssistantSelection}
export interface AssistantCancelResponse {requestId:string;status:'CANCELED'|'COMPLETED'}
export type AssistantRequestPhase='PREPARING'|'GENERATING'|'VALIDATING'|'REPAIRING'|'COMPLETED'|'CANCELED'|'FAILED'|'NOT_FOUND';
export interface AssistantRequestStatus {requestId:string;phase:AssistantRequestPhase}
export interface AssistantModelCatalogEntry {id:number;configName:string;model:string}
export interface AssistantChatResponse {reply:string;draft?:AssistantDraft;planning?:AssistantPlanning;questions?:AssistantQuestion[];modelCatalog?:AssistantModelCatalogEntry[];model:string;repaired?:boolean;attachments?:AssistantFileAttachment[];selections?:AssistantSelection}
export type AssistantTaskStatus='IDLE'|'RUNNING'|'COMPLETED'|'CANCELED'|'FAILED'|'INTERRUPTED';
export interface AssistantTask {id:string;requestId?:string;status:AssistantTaskStatus;phase:AssistantRequestPhase;error?:string;responseModel?:string;request?:AssistantChatRequest;userText?:string}
export interface AssistantTaskView {task:AssistantTask;session:AssistantSession}
export interface AssistantSessionSummary {id:string;title:string;projectId?:string;revision:number;updatedAt:string;messageCount:number;archived?:boolean;taskStatus?:AssistantTaskStatus;taskPhase?:AssistantRequestPhase;taskError?:string}
export interface AssistantSession extends AssistantSessionSummary {configId?:number;model?:string;reasoningEffort?:AssistantReasoningEffort|null;messages:AssistantChatMessage[];draft?:AssistantDraft;questionAnswers?:Record<string,unknown>;layoutMode?:'suggested'|'horizontal'|'vertical'|'grouped';attachments?:AssistantFileAttachment[];contextCards?:AssistantContextCard[];selections?:AssistantSelection;toolResults?:AssistantMcpCallResult[];input?:string;assistantTask?:AssistantTask}
export interface AssistantResource {id:string;name:string;description?:string;source?:string;enabled?:boolean;transport?:string;status?:string}
export interface AssistantResources {skills:AssistantResource[];mcp:AssistantResource[]}
export interface AssistantMcpTool {name:string;description?:string;inputSchema:Record<string,unknown>}
export interface AssistantMcpCallResult {id:string;resourceId:string;toolName:string;text:string;result?:unknown;error?:string}
export interface AssistantLocalFileEntry {name:string;path:string;directory:boolean;size?:number}
export interface AssistantLocalFileListing {path:string;parentPath?:string;entries:AssistantLocalFileEntry[]}
export interface CodexLinkStatus {linked:boolean;codexHome:string;skillsCount:number;mcpCount:number;warnings:string[]}
export interface Artifact {nodeId:string;name:string;path:string;size:number;sha256:string}
export interface NodeResult {label?:string;status:string;summary:string;input?:Record<string,unknown>;output?:Record<string,unknown>;error?:string;startedAt?:string;elapsedMs?:number;sentPreview?:string;sentCharacters?:number;reusedFrom?:string}
export interface Run {settingsSnapshot?:Record<string,unknown>;id:string;projectId:string;projectName:string;revision:number;status:string;nodeResults:Record<string,NodeResult>;artifacts:Artifact[];currentNodeId?:string;createdAt:string;error?:string;frozen:boolean;definition:Project;inputs:Record<string,unknown>;decisions:unknown[];parentRunId?:string;models?:Record<string,unknown>;frozenManifestSha256?:string}
export interface NodeTemplate {id:string;name:string;data:ResearchData}
export const statusName:Record<string,string>={QUEUED:'排队中',RUNNING:'执行中',WAITING_APPROVAL:'等待确认',PAUSED:'已暂停',SUCCESS:'成功',FAILED:'失败',REJECTED:'已退回',INTERRUPTED:'运行中断',CANCELLED:'已结束'};
export const statusColor:Record<string,string>={RUNNING:'processing',SUCCESS:'success',FAILED:'error',WAITING_APPROVAL:'warning',PAUSED:'warning',REJECTED:'error',INTERRUPTED:'error'};
