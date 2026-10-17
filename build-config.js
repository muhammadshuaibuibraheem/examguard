import fs from 'fs';
const e=process.env;
fs.rmSync('dist',{recursive:true,force:true});fs.mkdirSync('dist');
for(const f of ['index.html','styles.css','app.js'])fs.copyFileSync(f,'dist/'+f);
const cfg={mode:e.EGM_MODE||'mock',apiUrl:(e.EGM_API_URL||'').replace(/\/$/,''),staffDomain:e.EGM_STAFF_DOMAIN||'staff.examguard.local',
 firebase:{apiKey:e.FIREBASE_API_KEY,authDomain:e.FIREBASE_AUTH_DOMAIN,projectId:e.FIREBASE_PROJECT_ID,appId:e.FIREBASE_APP_ID}};
if(cfg.mode==='api'&&(!cfg.apiUrl||!cfg.firebase.apiKey||!cfg.firebase.projectId))throw new Error('API mode needs EGM_API_URL, FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_APP_ID');
fs.writeFileSync('dist/config.js','window.EGM_CONFIG='+JSON.stringify(cfg)+';');console.log('Built in',cfg.mode,'mode');
