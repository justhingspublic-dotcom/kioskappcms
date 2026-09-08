require('dotenv').config(); const sql=require('mssql'); const fs=require('fs');
const PROD='//192.168.1.82/D$/WebSite/JustDisplay/KioskAdmin/uploads', LOCAL='uploads';
(async()=>{const p=await sql.connect({server:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,options:{encrypt:false,trustServerCertificate:true}});
for(const r of (await p.request().query('SELECT DeviceId,DeviceName,Version,LastServerUrl,LastAppVersion,LastSeenAt,UpdatedAt,ConfigJson FROM dbo.KioskConfig')).recordset){
 const refs=[...new Set([...r.ConfigJson.matchAll(/\/files\/([\w.-]+)/g)].map(m=>m[1]))];
 console.log(`== ${r.DeviceId} ${r.DeviceName} v${r.Version} url=${r.LastServerUrl} app=${r.LastAppVersion} seen=${r.LastSeenAt?.toISOString()} updated=${r.UpdatedAt?.toISOString()}`);
 for(const f of refs)console.log(`  ${f} prod=${fs.existsSync(PROD+'/'+f)?'Y':'MISSING'} local=${fs.existsSync(LOCAL+'/'+f)?'Y':'-'}`);}
await p.close();})().catch(e=>{console.error(e.message);process.exit(1)});
