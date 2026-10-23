import type {Edge} from '@xyflow/react';
import type {Run} from './types';
export function runProgress(run?:Run|null):{total:number;complete:number;percent:number};
export function nodeRunState(run:Run|null|undefined,nodeId:string):'idle'|'active'|'waiting'|'paused'|'failed'|'success';
export function activeRunEdges(edges:Edge[],run:Run|null|undefined):Edge[];
export function runStatusLabel(status?:string):string;
export function runStatusAnnouncement(status?:string):string;
export function runStatusTransition(before:Run|null|undefined,after:Run|null|undefined,source?:'live'|'history'):{runId:string;previous:string;status:string;key:string}|null;
