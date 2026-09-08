export function makeCsv(result){
 const cell=value=>{let s=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);if(typeof value==='string'&&/^\s*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const trials=result.trials||[],keys=[...new Set(trials.flatMap(row=>Object.keys(row)))];
 const base=['student_id','task','task_version','run_id','started_at','finished_at','record_type','trial_index','summary_json','device_json'];
 const meta=[result.student,result.task,result.version,result.run,result.started,result.finished];
 const rows=[[...base,...keys.map(k=>'trial_'+k)],[...meta,'summary','',result.summary,result.device,...keys.map(()=> '')],...trials.map((row,i)=>[...meta,'trial',i+1,'','',...keys.map(k=>row[k])])];
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
