import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import admin from 'firebase-admin';
if(!process.env.FIREBASE_SERVICE_ACCOUNT_JSON){console.error('FIREBASE_SERVICE_ACCOUNT_JSON is required');process.exit(1)}
admin.initializeApp({credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))});
const db=admin.firestore(),TS=()=>admin.firestore.FieldValue.serverTimestamp(),Tm=admin.firestore.Timestamp;
const sha=s=>crypto.createHash('sha256').update(s).digest('hex'),newToken=()=>'T'+crypto.randomBytes(16).toString('hex');
const err=(s,m)=>Object.assign(new Error(m),{status:s});
const conv=o=>o instanceof Tm?o.toDate().toISOString():Array.isArray(o)?o.map(conv):o&&typeof o==='object'?Object.fromEntries(Object.entries(o).map(([k,v])=>[k,conv(v)])):o;
const wrap=f=>(q,r,n)=>f(q,r,n).catch(e=>{if(!e.status)console.error(e);r.status(e.status||500).json({error:e.status?e.message:'Server error'})});
const pub=s=>({id:s.id,matric:s.matric,name:s.name,dept:s.dept,faculty:s.faculty,programme:s.programme,level:s.level,session:s.session,active:!!s.active,tokenOk:!!s.activeTokenHash});
const audit=(u,a,t,id,md={})=>db.collection('auditLogs').add({a,t,id,by:u.staffId,uid:u.uid,metadata:md,m:Object.keys(md).length?JSON.stringify(md):'',at:TS()});
const app=express();app.set('trust proxy',1);app.use(helmet());
const origins=(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
app.use(cors({origin:(o,cb)=>cb(null,!o||origins.includes(o)),allowedHeaders:['Authorization','Content-Type'],methods:['GET','POST','PATCH']}));
app.use(express.json({limit:'200kb'}));app.use(rateLimit({windowMs:60000,limit:240}));
app.get('/health',(q,r)=>r.json({ok:true}));

const auth=wrap(async(q,r,n)=>{const h=q.headers.authorization||'';if(!h.startsWith('Bearer '))throw err(401,'Sign in required');
 let t;try{t=await admin.auth().verifyIdToken(h.slice(7))}catch{throw err(401,'Session expired, sign in again')}
 const s=await db.doc('users/'+t.uid).get();if(!s.exists||s.data().status!=='active')throw err(403,'Account is not authorised or is disabled');
 q.u={uid:t.uid,...s.data()};n()});
const need=(...roles)=>(q,r,n)=>roles.includes(q.u.role)?n():r.status(403).json({error:'Forbidden'});
const staff=need('admin','reviewer'),isInv=q=>q.u.role==='invigilator';
const api=express.Router();api.use(auth);

api.get('/me',(q,r)=>r.json({uid:q.u.uid,staffId:q.u.staffId,name:q.u.fullName,role:q.u.role,venue:q.u.venue||'',exam:q.u.examId||''}));
api.get('/exams',wrap(async(q,r)=>{const out=[];for(const d of (await db.collection('exams').limit(100).get()).docs){const e={id:d.id,...d.data()};
 e.expected=e.levels?.length?(await db.collection('students').where('active','==',true).where('level','in',e.levels.slice(0,30)).count().get()).data().count:0;out.push(e)}r.json(conv(out))}));

async function resolve(code){if(!code)return{err:'Empty code'};
 if(code.startsWith('EGM:')){const t=await db.doc('qrTokens/'+sha(code.slice(4))).get();if(!t.exists)return{err:'QR invalid'};
  if(t.data().status!=='active')return{err:'QR code revoked'};const s=await db.doc('students/'+t.data().studentId).get();return s.exists?{s:s.data()}:{err:'Student not found'}}
 const up=code.toUpperCase();let a=await db.collection('students').where('matric','==',up).limit(1).get();if(!a.empty)return{s:a.docs[0].data()};
 if(/^[A-Za-z0-9_-]+$/.test(code)){const b=await db.doc('students/'+up).get();if(b.exists)return{s:b.data()}}
 a=await db.collection('students').where('barcode','==',code).limit(1).get();return a.empty?{err:'Student not found'}:{s:a.docs[0].data()}}
api.get('/students/lookup',wrap(async(q,r)=>{const code=String(q.query.code||'').trim().slice(0,200),x=await resolve(code);
 const ex=q.u.examId?(await db.doc('exams/'+q.u.examId).get()).data():null;let why=null,result=x.err||'Verified';
 if(x.s){if(!x.s.active)why='Inactive record';else if(ex&&!ex.levels.includes(x.s.level))why='Not registered for '+ex.code;if(why)result='Ineligible'}
 const sid=x.s?.id||'unknown-'+sha(code).slice(0,8);
 await db.doc(`verificationEvents/${q.u.uid}_${sid}_${Math.floor(Date.now()/8000)}`).create({sid,name:x.s?.name||'—',by:q.u.staffId,uid:q.u.uid,ok:!!x.s,result,examId:q.u.examId||null,venue:q.u.venue||null,source:'api',at:TS()}).catch(e=>{if(e.code!==6)throw e});
 r.json(x.s?{s:pub(x.s),why,exam:ex?{code:ex.code,title:ex.title}:null}:{err:x.err})}));
api.get('/events',wrap(async(q,r)=>{let c=db.collection('verificationEvents');c=isInv(q)?c.where('uid','==',q.u.uid).orderBy('at','desc').limit(100):c.orderBy('at','desc').limit(200);r.json(conv((await c.get()).docs.map(d=>d.data())))}));

const RS=['Draft','Submitted','Under review','Additional information requested','Resolved','Closed'];
api.get('/reports',wrap(async(q,r)=>{let c=db.collection('malpracticeReports');if(isInv(q))c=c.where('uid','==',q.u.uid);
 let l=(await c.orderBy('at','desc').limit(300).get()).docs.map(d=>d.data());if(!isInv(q))l=l.filter(x=>x.status!=='Draft');r.json(conv(l))}));
api.get('/reports/:ref',wrap(async(q,r)=>{const d=await db.doc('malpracticeReports/'+q.params.ref).get();if(!d.exists)throw err(404,'Report not found');const x=d.data();
 if(isInv(q)?x.uid!==q.u.uid:x.status==='Draft')throw err(403,'Forbidden');
 r.json(conv({...x,hist:(await d.ref.collection('history').orderBy('at','asc').get()).docs.map(z=>z.data())}))}));
api.post('/reports',need('invigilator'),wrap(async(q,r)=>{const b=q.body||{},str=(k,m)=>String(b[k]??'').trim().slice(0,m);
 const key=str('key',80),status=b.status==='Submitted'?'Submitted':'Draft',sid=str('sid',40),type=str('type',120),desc=str('desc',5000);
 if(key.length<8)throw err(400,'Missing request key');if(!type)throw err(400,'Incident type is required');
 if(status==='Submitted'&&(desc.length<20||!str('when',40)||!str('loc',200)||!str('act',2000)))throw err(400,'Complete all required fields before submitting');
 const st=await db.doc('students/'+sid).get();if(!st.exists)throw err(400,'Student not found');const s=st.data();
 const ex=q.u.examId?(await db.doc('exams/'+q.u.examId).get()).data():null;
 const ref='MPR-'+sha(q.u.uid+key).slice(0,8).toUpperCase(),rr=db.doc('malpracticeReports/'+ref),cur=await rr.get();
 if(cur.exists){const c=cur.data();if(c.uid!==q.u.uid)throw err(403,'Forbidden');if(c.status!=='Draft')return r.json(conv(c))} // idempotent replay; submitted reports are immutable here
 const data={ref,uid:q.u.uid,sid,name:s.name,matric:s.matric,exam:ex?ex.code+' '+ex.title:'—',type,when:str('when',40),loc:str('loc',200),desc,mat:str('mat',500),wit:str('wit',1000),act:str('act',2000),status,by:q.u.staffId,inv:q.u.fullName+' ('+q.u.staffId+')',examId:q.u.examId||null,updatedAt:TS()};
 if(!cur.exists)data.at=TS();if(status==='Submitted')data.sub=TS();
 await rr.set(data,{merge:true});await rr.collection('history').add({a:status==='Draft'?'Draft saved':'Submitted',c:'',by:q.u.staffId,at:TS()});
 await audit(q.u,'report '+status.toLowerCase(),'report',ref);r.json(conv((await rr.get()).data()))}));
api.post('/reports/:ref/review',staff,wrap(async(q,r)=>{const{status,comment}=q.body||{},c=String(comment||'').trim().slice(0,2000);
 if(!RS.slice(2).includes(status))throw err(400,'Invalid status');if(!c)throw err(400,'A reason is required');
 const rr=db.doc('malpracticeReports/'+q.params.ref);let prev;
 await db.runTransaction(async t=>{const d=await t.get(rr);if(!d.exists||d.data().status==='Draft')throw err(404,'Report not found');prev=d.data().status;
  t.update(rr,{status,reviewerUid:q.u.uid,updatedAt:TS()});t.set(rr.collection('history').doc(),{a:prev+' → '+status,c,by:q.u.staffId,at:TS()})});
 await audit(q.u,'report review','report',q.params.ref,{from:prev,to:status});r.json({ok:true})}));

api.get('/students',staff,wrap(async(q,r)=>r.json((await db.collection('students').orderBy('id').limit(500).get()).docs.map(d=>pub(d.data())))));
api.post('/students',need('admin'),wrap(async(q,r)=>{const b=q.body||{},s=k=>String(b[k]??'').trim().slice(0,120);
 const d={id:s('id').toUpperCase(),matric:s('matric').toUpperCase(),name:s('name'),dept:s('dept'),faculty:s('faculty'),programme:s('programme')||'MBBS',level:Number(b.level),session:s('session'),active:true,createdAt:TS()};
 if(!/^[A-Z0-9_-]{3,20}$/.test(d.id)||!d.matric||!d.name||!d.dept||![100,200,300,400,500,600].includes(d.level))throw err(400,'Invalid student data');
 if(!(await db.collection('students').where('matric','==',d.matric).limit(1).get()).empty)throw err(409,'Matric number already exists');
 await db.doc('students/'+d.id).create(d).catch(e=>{throw e.code===6?err(409,'Student ID already exists'):e});await audit(q.u,'student created','student',d.id);r.status(201).json(pub(d))}));
api.patch('/students/:id/active',need('admin'),wrap(async(q,r)=>{const ref=db.doc('students/'+q.params.id);if(!(await ref.get()).exists)throw err(404,'Not found');
 await ref.update({active:!!q.body?.active,updatedAt:TS()});await audit(q.u,q.body?.active?'student activated':'student deactivated','student',q.params.id);r.json({ok:true})}));

async function issue(q,s,bid){const tk=newToken(),h=sha(tk),w=db.batch();
 if(s.activeTokenHash)w.set(db.doc('qrTokens/'+s.activeTokenHash),{status:'revoked',revokedAt:TS(),revokedBy:q.u.uid},{merge:true});
 w.set(db.doc('qrTokens/'+h),{studentId:s.id,batchId:bid,status:'active',createdAt:TS(),createdBy:q.u.uid});w.update(db.doc('students/'+s.id),{activeTokenHash:h});await w.commit();return tk}
api.post('/batches',need('admin'),wrap(async(q,r)=>{const{dept='',level=''}=q.body||{};let c=db.collection('students').where('active','==',true);
 if(dept)c=c.where('dept','==',String(dept));if(level)c=c.where('level','==',Number(level));
 const list=(await c.limit(500).get()).docs.map(d=>d.data()),bid='B-'+crypto.randomBytes(3).toString('hex').toUpperCase(),out=[];
 for(const s of list)out.push({...pub(s),token:await issue(q,s,bid),tokenOk:true}); // one active token per student; older tokens are revoked
 await db.doc('qrBatches/'+bid).set({batchId:bid,filters:{dept,level},studentCount:out.length,status:'active',createdBy:q.u.uid,createdAt:TS()});
 await audit(q.u,'qr batch generated','batch',bid,{count:out.length});r.json(out)}));
api.post('/students/:id/token/revoke',need('admin'),wrap(async(q,r)=>{const ref=db.doc('students/'+q.params.id),s=(await ref.get()).data();if(!s)throw err(404,'Not found');
 if(s.activeTokenHash){await db.doc('qrTokens/'+s.activeTokenHash).set({status:'revoked',revokedAt:TS(),revokedBy:q.u.uid},{merge:true});await ref.update({activeTokenHash:admin.firestore.FieldValue.delete()})}
 await audit(q.u,'token revoked','student',q.params.id);r.json({ok:true})}));
api.post('/students/:id/token/reissue',need('admin'),wrap(async(q,r)=>{const s=(await db.doc('students/'+q.params.id).get()).data();if(!s)throw err(404,'Not found');
 const token=await issue(q,s,'reissue');await audit(q.u,'token reissued','student',q.params.id);r.json({token})}));
api.get('/audit',staff,wrap(async(q,r)=>r.json(conv((await db.collection('auditLogs').orderBy('at','desc').limit(100).get()).docs.map(d=>d.data())))));

app.use('/api',api);app.use((e,q,r,n)=>r.status(400).json({error:'Bad request'}));
app.listen(process.env.PORT||3000,()=>console.log('ExamGuard API listening'));
