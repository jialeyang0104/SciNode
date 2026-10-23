import type {AssistantContextCard,Project,Run} from './types';
export function redactContextText(value?:unknown):string;
export function createProjectContextCard(project:Project):AssistantContextCard;
export function createRunErrorContextCard(run:Run,focusNodeId?:string):AssistantContextCard;
export function contextCardsCharacters(cards?:AssistantContextCard[]):number;
export function formatContextCardsForModel(cards?:AssistantContextCard[]):string;
export function materialOnlyPrompt(content:string,hasSelectedMaterial:boolean):string;
