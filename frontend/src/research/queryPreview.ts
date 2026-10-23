export interface QueryPreview {
 name:string;port:number;database:string;status:string;columns:string[];rows:unknown[][];
 returned_rows:number;preview_rows?:number;truncated:boolean;max_rows?:number;
}

export function queryPreviews(value:unknown):QueryPreview[]{
 if(!Array.isArray(value))return [];
 return value.filter((item):item is QueryPreview=>!!item&&typeof item==='object'
  &&typeof item.name==='string'&&typeof item.database==='string'&&typeof item.port==='number'
  &&Array.isArray(item.columns)&&item.columns.every((column:unknown)=>typeof column==='string')
  &&Array.isArray(item.rows)&&item.rows.every((row:unknown)=>Array.isArray(row)&&row.length===item.columns.length)
  &&typeof item.returned_rows==='number');
}
