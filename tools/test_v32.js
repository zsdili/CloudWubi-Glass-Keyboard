const fs=require('fs'),vm=require('vm');
const app=fs.readFileSync('android-build/web-src/app.js','utf8');
function extract(name){
  const m=new RegExp('function '+name+'\\s*\\(').exec(app);
  let i=app.indexOf('{',m.index),depth=0,j=i;
  for(;j<app.length;j++){const c=app[j];if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0){j++;break;}}}
  return app.slice(m.index,j);
}
const sb={window:{}};vm.createContext(sb);
vm.runInContext(fs.readFileSync('android-build/CloudWubiKeyboard/app/src/main/assets/web/data_wubi.js','utf8'),sb);
const WUBI=sb.window.WUBI_INDEX;
if(!WUBI) throw new Error('WUBI_INDEX 未定义');
const UC={};
Object.keys(WUBI).forEach(code=>{ if(code.length<3)return;
  (WUBI[code]||[]).forEach(o=>{ if(o.t.length===1&&(!UC[o.t]||code.length>UC[o.t].length))UC[o.t]=code; });});
const ctx={WUBI,UC,cloudIndex:{},LOCAL_FREQ:{},state:{recent:[],mode:'smart'},
  SYMBOL_WORDS:[],WORD2CODE:{},console};
vm.createContext(ctx);
['userPhraseCode','canMakeAll','makeUnknown','segLexicon','segmentText','queryWubi'].forEach(n=>{
  vm.runInContext(extract(n),ctx);
});
let pass=0,fail=0;
function ok(name,cond,extra){ if(cond){pass++;console.log('PASS',name);}else{fail++;console.log('FAIL',name,extra||'');} }

ok("UC含豆(gkuf)",UC['豆']==='gkuf',UC['豆']);
ok("UC含包(qnv)",UC['包']==='qnv',UC['包']);
// 端侧本地已含两字词 豆包 gkqn
ok("端侧WUBI含豆包(gkqn)",JSON.stringify((WUBI['gkqn']||[]).map(o=>o.t)).includes('豆包'));
// 端侧本地豆包命中（不是临时造）
let t5=vm.runInContext("segmentText('豆包',segLexicon()).map(o=>o.t).join('')",ctx);
ok("文本框'豆包'本地命中",t5==='豆包',t5);
// 2字未登录（空词典）不造
let t2=vm.runInContext("JSON.stringify(segmentText('豆包',{}))",ctx);
ok("2字未登录不造",t2==='[]',t2);
// 3字未登录造词（每字全码齐）
let t3=vm.runInContext("segmentText('豆包好',{}).map(o=>o.t+'='+o.c).join('')",ctx);
ok("3字未登录造词",/豆包好=gqvb/.test(t3),t3);
// 4字整体（短句优先，不切碎）
let t4=vm.runInContext("segmentText('豆包很好',{}).map(o=>o.t).join('')",ctx);
ok("4字整体造不切碎",t4==='豆包很好',t4);
// 6字短句优先
let t6=vm.runInContext("segmentText('豆包很好吃吗',{}).map(o=>o.t).join('')",ctx);
ok("6字整体短句优先",t6==='豆包很好吃吗',t6);
// 标点分隔（端侧本地含豆包/我们）
let t7=vm.runInContext("segmentText('豆包，我们',segLexicon()).map(o=>o.t).join('|')",ctx);
ok("标点分隔",t7==='豆包|我们',t7);
// 来源标记
vm.runInContext("cloudIndex['abcd']=[{t:'云端词甲',f:100}];",ctx);
let rc=vm.runInContext("queryWubi('abcd').find(o=>o.t==='云端词甲')",ctx);
ok("云端 src=cloud",rc&&rc.src==='cloud',JSON.stringify(rc));
const day=Math.floor(Date.now()/86400000);
vm.runInContext("LOCAL_FREQ['efgh']=[{t:'本地词乙',c:5,d:"+day+"}];",ctx);
let rl=vm.runInContext("queryWubi('efgh')[0]",ctx);
ok("本地词 src=local 且首选",rl&&rl.t==='本地词乙'&&rl.src==='local',JSON.stringify(rl));
// 简码端侧 base
let rb=vm.runInContext("queryWubi('g')",ctx).map(o=>o.src);
ok("简码 src=base",rb.every(s=>s==='base')&&rb.length>0,JSON.stringify(rb));

console.log('\n结果: '+pass+' PASS, '+fail+' FAIL');
process.exit(fail?1:0);
