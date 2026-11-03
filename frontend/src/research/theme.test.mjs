import test from 'node:test';
import assert from 'node:assert/strict';
import {palette,applyThemeVariables} from '../theme.ts';

function luminance(hex){
 const rgb=[1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
 return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}
function contrast(a,b){const [dark,light]=[luminance(a),luminance(b)].sort((a,b)=>a-b);return (light+.05)/(dark+.05);}

test('workspace text and status tokens meet 4.5:1 on their actual light surfaces',()=>{
 for(const foreground of ['text','textSecondary','textMuted']){
  for(const background of ['surface','surfaceSubtle','background','canvas','primarySoft']){
   assert.ok(contrast(palette[foreground],palette[background])>=4.5,`${foreground} on ${background}`);
  }
 }
 for(const role of ['primary','success','warning','error','info']){
  assert.ok(contrast(palette[role],palette[role+'Soft'])>=4.5,`${role} status`);
 }
 assert.ok(contrast(palette.surface,palette.primary)>=4.5,'primary button text');
 assert.ok(contrast(palette.surface,palette.primaryHover)>=4.5,'hovered primary button text');
});

test('CSS variables and Ant Design share the same palette',()=>{
 const variables=new Map();
 applyThemeVariables({style:{setProperty:(name,value)=>variables.set(name,value)}});
 assert.equal(variables.get('--primary'),palette.primary);
 assert.equal(variables.get('--text-secondary'),palette.textSecondary);
 assert.equal(variables.get('--primary-soft'),palette.primarySoft);
 assert.ok(variables.get('--font-ui').includes('PingFang SC'));
});
