export type ValueRecord = Record<string, unknown>;

export interface ResearchTaskPreset {
  id: string;
  label: string;
  guidance: string;
  prompt: string;
}

export interface SchemaFieldDefinition {
  name:string;
  type:string;
  required:boolean;
  schema:Record<string,unknown>;
}

export function applyPromptPreset<T extends ValueRecord>(data: T, preset: ResearchTaskPreset, source='{{input.text}}'): T {
  return { ...data, prompt: preset.prompt.replace('{{input.text}}',source) };
}

export function findPromptPresetMatch(prompt:string,presets:ResearchTaskPreset[]):{preset:ResearchTaskPreset;source:string}|undefined{
  const marker='{{input.text}}';
  for(const preset of presets){
    const split=preset.prompt.split(marker);
    if(split.length!==2)continue;
    const [before,after]=split;
    if(prompt===preset.prompt)return {preset,source:marker};
    if(!prompt.startsWith(before)||!prompt.endsWith(after))continue;
    const source=prompt.slice(before.length,prompt.length-after.length);
    if(/^\{\{[^{}]+\}\}$/.test(source))return {preset,source};
  }
  return undefined;
}

function isRecord(value:unknown):value is ValueRecord{return !!value&&typeof value==='object'&&!Array.isArray(value);}

function fillMissing(existing:unknown,example:unknown):unknown{
  if(existing===undefined||existing==='')return example;
  if(isRecord(existing)&&isRecord(example)){
    const merged={...existing};
    for(const [key,value] of Object.entries(example))merged[key]=fillMissing(existing[key],value);
    return merged;
  }
  return existing;
}

export function fillBlankExample<T extends ValueRecord>(data:T,example:ValueRecord):T{
  const next:ValueRecord={...data};
  const protectedKeys=new Set(['kind','label','configId','model','fileId','inputs']);
  for(const [key,value] of Object.entries(example))if(!protectedKeys.has(key))next[key]=fillMissing(data[key],value);
  return next as T;
}

export function setRecordValue(value: ValueRecord, key: string, next: unknown): ValueRecord {
  return { ...value, [key]: next };
}

export function renameRecordKey(value: ValueRecord, oldKey: string, nextKey: string): ValueRecord {
  if (oldKey === nextKey || !nextKey.trim() || Object.prototype.hasOwnProperty.call(value, nextKey)) return value;
  const next: ValueRecord = {};
  for (const [key, entry] of Object.entries(value)) next[key === oldKey ? nextKey : key] = entry;
  return next;
}

export function removeRecordKey(value: ValueRecord, key: string): ValueRecord {
  const next = { ...value };
  delete next[key];
  return next;
}

export function appendArrayValue(value: unknown[], next: unknown): unknown[] {
  return [...value, next];
}

export function removeArrayValue(value: unknown[], index: number): unknown[] {
  return value.filter((_, current) => current !== index);
}

export function defaultForSchema(schema: Record<string, unknown>): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.find(item => item !== 'null') : schema.type;
  if (type === 'object') return {};
  if (type === 'array') return [];
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return false;
  if (type === 'null') return null;
  return '';
}

export function schemaFieldDefinitions(schema:Record<string,unknown>):SchemaFieldDefinition[]{
  const properties=schema.properties&&typeof schema.properties==='object'&&!Array.isArray(schema.properties)?schema.properties as Record<string,unknown>:{};
  const required=Array.isArray(schema.required)?schema.required.filter((name):name is string=>typeof name==='string'):[];
  return Object.entries(properties).map(([name,raw])=>{
    const field=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
    const declared=Array.isArray(field.type)?field.type.find(type=>type!=='null'):field.type;
    const type=typeof declared==='string'?declared:Array.isArray(field.enum)?'enum':'string';
    return {name,type,required:required.includes(name),schema:field};
  });
}

export function hasUnsupportedSchema(schema:Record<string,unknown>):boolean{
  const unsupported=['$ref','$dynamicRef','$defs','definitions','oneOf','anyOf','allOf','prefixItems','not','if','then','else','patternProperties','propertyNames','dependencies','dependentRequired','dependentSchemas','unevaluatedProperties','unevaluatedItems','contains','minContains','maxContains'];
  if(unsupported.some(key=>Object.prototype.hasOwnProperty.call(schema,key))||Array.isArray(schema.items))return true;
  const additional=schema.additionalProperties;
  if(additional&&typeof additional==='object'&&!Array.isArray(additional)&&hasUnsupportedSchema(additional as Record<string,unknown>))return true;
  if(schema.items&&typeof schema.items==='object'&&!Array.isArray(schema.items)&&hasUnsupportedSchema(schema.items as Record<string,unknown>))return true;
  if(schema.properties&&typeof schema.properties==='object'&&!Array.isArray(schema.properties))return Object.values(schema.properties as Record<string,unknown>).some(field=>!!field&&typeof field==='object'&&!Array.isArray(field)&&hasUnsupportedSchema(field as Record<string,unknown>));
  return false;
}
