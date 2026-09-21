const fs = require('fs');
const sylData = require('./pygen_syl.json');
const syls = Object.keys(sylData);

const schemes = [
  { name: 'flypy', file: 'double_pinyin_flypy', label: '小鹤' },
  { name: 'zrm', file: 'double_pinyin', label: '自然码' },
  { name: 'mspy', file: 'double_pinyin_mspy', label: '微软' },
  { name: 'abc', file: 'double_pinyin_abc', label: '智能ABC' },
  { name: 'pyjj', file: 'double_pinyin_pyjj', label: '拼音加加' }
];

function parseRules(text) {
  const seg = text.split('algebra:')[1].split(/\n[a-z]/)[0];
  const rules = [];
  for (let line of seg.split('\n')) {
    line = line.trim();
    if (!line.startsWith('-')) continue;
    line = line.replace(/^-\s*/, '');
    const hi = line.indexOf(' #'); if (hi >= 0) line = line.slice(0, hi);
    const cmd = line.match(/^[a-z]+/)[0];
    const rest = line.slice(cmd.length);
    const parts = []; let cur = '', esc = false;
    for (const c of rest) {
      if (esc) { cur += c; esc = false; }
      else if (c === '\\') { cur += c; esc = true; }
      else if (c === '/') { parts.push(cur); cur = ''; }
      else cur += c;
    }
    if (cur !== '' || parts.length) parts.push(cur);
    const args = parts.slice(1, parts.length - (cur === '' ? 1 : 0));
    rules.push({ cmd, args });
  }
  return rules;
}
function apply(set, rules, errs) {
  for (const r of rules) {
    try {
      if (r.cmd === 'erase') {
        const re = new RegExp(r.args[0]);
        for (const s of [...set]) if (re.test(s)) set.delete(s);
      } else if (r.cmd === 'xform') {
        const re = new RegExp(r.args[0]), to = r.args[1];
        const n = new Set(); for (const s of set) n.add(s.replace(re, to)); set = n;
      } else if (r.cmd === 'derive') {
        const re = new RegExp(r.args[0]), to = r.args[1];
        for (const s of [...set]) if (re.test(s)) set.add(s.replace(re, to));
      } else if (r.cmd === 'xlit') {
        const f = r.args[0], t = r.args[1];
        const n = new Set();
        for (const s of set) {
          let o = ''; for (const c of s) { const i = f.indexOf(c); o += i >= 0 ? t[i] : c; }
          n.add(o);
        }
        set = n;
      }
    } catch (e) { errs.push(r.cmd + ' ' + r.args[0] + ' : ' + e.message); }
  }
  return set;
}

const outDir = '../CloudWubiKeyboard/app/src/main/assets/web/py';
let report = {};
for (const sc of schemes) {
  const text = fs.readFileSync('rime-double-pinyin/' + sc.file + '.schema.yaml', 'utf8');
  const rules = parseRules(text);
  const errs = [];
  const dp2syl = {};
  let bad = [];
  for (const s of syls) {
    let set = new Set([s]);
    set = apply(set, rules, errs);
    for (const d of set) {
      if (d.length !== 2 || !/^[a-z;]+$/.test(d)) { bad.push([s, d]); continue; }
      (dp2syl[d] = dp2syl[d] || []).push(s);
    }
  }
  fs.writeFileSync(outDir + '/dp_' + sc.name + '.json', JSON.stringify(dp2syl));
  report[sc.label] = { keys: Object.keys(dp2syl).length, ruleErrs: errs.slice(0, 3), bad: bad.slice(0, 5) };
}
// 小鹤验证
const fly = require(outDir + '/dp_flypy.json');
report._verify = { zhong: fly.vs, guo: fly.go, ren: fly.rf };
console.log(JSON.stringify(report, null, 1));
