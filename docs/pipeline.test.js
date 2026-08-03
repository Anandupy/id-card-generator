/* Pure-logic tests for the data pipeline. Run: node docs/pipeline.test.js
 * Loads the real service modules under a minimal browser shim and asserts
 * against the shipped sample data. Requires the 'xlsx' vendor build. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
global.window = global;
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
global.document = { createElement(){return {getContext(){return {};}};}, querySelector(){return null;}, querySelectorAll(){return [];}, addEventListener(){} };
global.FileReader = class { readAsArrayBuffer(f){ this.result=f._buf; setTimeout(()=>this.onload&&this.onload(),0);} readAsDataURL(){ this.result='data:image/png;base64,AAAA'; setTimeout(()=>this.onload&&this.onload(),0);} };
global.TextDecoder = require('util').TextDecoder;
// XLSX: use the vendored browser build
global.XLSX = require(path.join(ROOT,'vendor','xlsx.full.min.js'));
['js/utils.js','js/preset.js','js/excel.js','js/photos.js','js/validation.js'].forEach(f=>require(path.join(ROOT,f)));
const IDCS = global.IDCS;
let fail = 0; const ok = (c,m)=>{ console.log((c?'  ✓ ':'  ✗ ')+m); if(!c) fail++; };

const buf = fs.readFileSync(path.join(ROOT,'sample','students-sample.xlsx'));
const wb = XLSX.read(buf,{type:'buffer',cellDates:true});
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:'',raw:false});
const headers = rows[0].map(String);
const records = rows.slice(1).filter(r=>r.some(c=>String(c).trim())).map(r=>{const o={};headers.forEach((h,i)=>o[h]=String(r[i]==null?'':r[i]));return o;});
const mapping = IDCS.Excel.autoMap(headers);
const students = IDCS.Excel.buildStudents(records, mapping);

console.log('Pipeline tests:');
ok(headers.length===12, 'detects 12 columns');
ok(mapping.name==='Student Name', 'maps name → Student Name');
ok(mapping.cid==='C-ID', 'maps cid → C-ID (not Roll No)');
ok(students.length===24, 'builds 24 students');
ok(students[0].data.dob==='05-Jun-2012', 'reads DOB value');

const files = fs.readdirSync(path.join(ROOT,'sample','photos')).map(n=>({name:n}));
IDCS.Photos.match(files, students).then(res=>{
  ok(res.matched>=22, 'auto-matches photos by C-ID ('+res.matched+')');
  const rep = IDCS.Validation.run({students, unmatchedPhotos:res.unmatched, columns:headers, mapping});
  ok(rep.counts.error>=0 && rep.withPhoto>=22, 'validation report runs ('+rep.withPhoto+'/'+rep.students+' with photo)');
  console.log(fail? '\nFAILED: '+fail : '\nALL TESTS PASSED');
  process.exit(fail?1:0);
});
