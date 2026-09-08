import React from 'react';
import {createRoot} from 'react-dom/client';
import '../app/globals.css';
import {BrainCircuit} from 'lucide-react';

function PendingConnection(){
 return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:'24px'}}>
  <section style={{maxWidth:600,width:'100%',background:'white',padding:'40px',borderRadius:24,border:'1px solid #e2e8f0'}}>
   <BrainCircuit size={40} aria-hidden="true" style={{color:'#2563eb',marginBottom:24}}/>
   <p style={{color:'#64748b',marginBottom:12}}>认知实验任务平台</p>
   <h1 style={{fontSize:30,fontWeight:700,marginBottom:20}}>测试暂未开放</h1>
   <p style={{fontSize:17,lineHeight:1.8,color:'#475569'}}>网站正在完成数据服务连接。请等待老师通知后再参加测试。</p>
   <p style={{marginTop:24,fontSize:14,color:'#64748b'}}>当前页面不收集学生信息，也不开始实验。</p>
  </section>
 </main>;
}
const root=createRoot(document.getElementById('root')!);
if(process.env.NEXT_PUBLIC_LAB_API_ORIGIN){
 const admin=location.pathname.replace(/\/$/,'')==='/admin';
 void (admin?import('../app/admin/page'):import('../app/page')).then(({default:Page})=>root.render(<Page/>));
}else root.render(<PendingConnection/>);
