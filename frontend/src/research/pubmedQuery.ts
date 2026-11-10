import type {PubmedSearch} from './types';
const publicationTypes:Record<string,string>={rct:'Randomized Controlled Trial[Publication Type]',cohort:'cohort[Title/Abstract]',meta:'Meta-Analysis[Publication Type]',review:'Review[Publication Type]'};
export function buildPubmedQuery(search:PubmedSearch,today=new Date()):string{
 const concept=(text='')=>{const terms=text.split(/[,，;；]/).map(term=>term.replace(/["\r\n]/g,' ').trim()).filter(Boolean);return terms.length?'('+terms.map(term=>`"${term}"[Title/Abstract]`).join(' OR ')+')':'';};
 const clauses=[concept(search.population),concept(search.exposure),concept(search.outcome)].filter(Boolean);
 if(!clauses.length)return '';
 if(search.years){const year=today.getFullYear(),end=`${year}/${String(today.getMonth()+1).padStart(2,'0')}/${String(today.getDate()).padStart(2,'0')}`;clauses.push(`("${year-search.years+1}/01/01"[Date - Publication] : "${end}"[Date - Publication])`);}
 const types=(search.types||[]).map(type=>publicationTypes[type]).filter(Boolean);if(types.length)clauses.push('('+types.join(' OR ')+')');
 return clauses.join(' AND ');
}
