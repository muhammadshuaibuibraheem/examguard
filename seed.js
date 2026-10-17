// DEMO DATA ONLY. Creates fictional students/exam + 3 staff accounts in YOUR Firebase project. Do not run against real institutional data.
import admin from 'firebase-admin';
admin.initializeApp({credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))});
const db=admin.firestore(),TS=admin.firestore.FieldValue.serverTimestamp(),PW=process.env.SEED_PASSWORD,DOM=process.env.EGM_STAFF_DOMAIN||'staff.examguard.local';
if(!PW||PW.length<10){console.error('Set SEED_PASSWORD (10+ chars)');process.exit(1)}
const F=['Amina','Chidi','Ngozi','Tunde','Zainab','Emeka','Fatima','Kelechi','Yusuf','Ify'],L=['Okafor','Bello','Adeyemi','Musa','Eze','Ibrahim','Nwosu','Lawal','Danjuma','Okoro'],D=['Anatomy','Physiology','Biochemistry'];
const w=db.batch();
w.set(db.doc('exams/E1'),{code:'ANA201',title:'Gross Anatomy II',date:'2026-10-20',time:'09:00',venue:'Hall A',levels:[200]});
w.set(db.doc('exams/E2'),{code:'PHY301',title:'Cardiovascular Physiology',date:'2026-10-21',time:'10:00',venue:'Hall B',levels:[300]});
for(let i=0;i<30;i++){const id='S'+(1001+i);w.set(db.doc('students/'+id),{id,matric:`MED/${21+i%3}/${100+i}`,name:`${F[i%10]} ${L[(i*3)%10]}`,dept:D[i%3],faculty:'Basic Medical Sciences',programme:'MBBS',level:[200,300,400][i%3],session:'2025/2026',active:i!==7,createdAt:TS})}
await w.commit();
for(const u of [{staffId:'INV-001',fullName:'Dr. Sani Garba',role:'invigilator',venue:'Hall A',examId:'E1'},{staffId:'ADM-001',fullName:'Prof. Hauwa Yakubu',role:'admin'},{staffId:'REV-001',fullName:'Dr. Ibrahim Lawal',role:'reviewer'}]){
 const email=`${u.staffId.toLowerCase()}@${DOM}`;let a;try{a=await admin.auth().getUserByEmail(email);await admin.auth().updateUser(a.uid,{password:PW})}catch{a=await admin.auth().createUser({email,password:PW,displayName:u.fullName})}
 await db.doc('users/'+a.uid).set({...u,uid:a.uid,email,status:'active',createdAt:TS},{merge:true});console.log('user',u.staffId,'->',email)}
console.log('Seeded. Sign in with the staff ID + SEED_PASSWORD.');process.exit(0);
