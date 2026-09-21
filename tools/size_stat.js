const fs=require('fs'),vm=require('vm'),zlib=require('zlib');
const sb={window:{}};vm.createContext(sb);
vm.runInContext(fs.readFileSync('data_wubi.full.v30.js','utf8'),sb);
const RAW=sb.window.WUBI_RAW;
const g={1:[],2:[],3:[],4:[],L:[]};
RAW.forEach(line=>{const p=line.split(' ');const L=[...p[1]].length;
 (L===1?g[1]:L===2?g[2]:L===3?g[3]:L===4?g[4]:g.L).push([p[0],p[1]]);});
console.log('总条数',RAW.length);
[1,2,3,4,'L'].forEach(k=>console.log((k==='L'?'5字+':k+'字词'),'条数',g[k].length));
function size(rows){const idx={};rows.forEach(([c,w])=>{(idx[c]=idx[c]||[]).push(w);});
 const js=JSON.stringify(idx);return {codes:Object.keys(idx).length,raw:Buffer.byteLength(js),deflate:zlib.deflateSync(js,{level:9}).length};}
console.log('--- 仅2字词 ---',JSON.stringify(size(g[2])));
console.log('--- 仅3字词 ---',JSON.stringify(size(g[3])));
console.log('--- 2+3字词 ---',JSON.stringify(size(g[2].concat(g[3]))));
console.log('--- 4字词 ---',JSON.stringify(size(g[4])));
console.log('--- 5字+ ---',JSON.stringify(size(g.L)));
