/**
 * A simulated feature phone, served as one self-contained page.
 *
 * It drives the real gateway endpoint over the real protocol — accumulating input with '*'
 * exactly as a telco does — so what you see on this screen is what a Nokia would show.
 */
export const PHONE_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ssente Zaffe — feature phone</title><style>
:root{--case:#2b2f36;--screenbg:#c3d7a4;--screenfg:#1b2416;--key:#3a3f47;--keyfg:#e8eaed;--accent:#0f766e}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;gap:1rem;padding:1.5rem 16px;
 background:#12151a;color:#cbd5e1;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.intro{max-width:30rem;text-align:center}
.intro h1{font-size:1.15rem;margin:.2rem 0;color:#e8eaed}
.intro p{color:#94a3b8;font-size:.88rem;margin:.3rem 0}
.phone{width:min(20rem,100%);background:var(--case);border-radius:1.6rem;padding:1rem;
 box-shadow:0 14px 40px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.07)}
.brand{text-align:center;color:#8b929c;font-size:.66rem;letter-spacing:.22em;margin-bottom:.5rem}
.screen{background:var(--screenbg);color:var(--screenfg);border-radius:.3rem;padding:.6rem;
 min-height:11rem;font-family:ui-monospace,"Courier New",monospace;font-size:12.5px;line-height:1.35;
 white-space:pre-wrap;word-break:break-word;box-shadow:inset 0 2px 6px rgba(0,0,0,.35)}
.count{display:flex;justify-content:space-between;font-family:ui-monospace,monospace;
 font-size:.62rem;color:#8b929c;margin:.35rem .1rem}
.count .over{color:#fca5a5;font-weight:700}
.entry{margin:.5rem 0;display:flex;gap:.4rem}
.entry input{flex:1;min-width:0;background:#1d2127;border:1px solid #4b5563;color:#e8eaed;border-radius:.3rem;
 padding:.45rem .5rem;font-family:ui-monospace,monospace;font-size:.85rem}
.entry button{background:var(--accent);border:0;color:#fff;border-radius:.3rem;padding:.45rem .7rem;
 font:inherit;font-size:.82rem;cursor:pointer}
.pad{display:grid;grid-template-columns:repeat(3,1fr);gap:.4rem;margin-top:.5rem}
.pad button{background:var(--key);color:var(--keyfg);border:0;border-radius:.45rem;padding:.6rem 0;
 font:inherit;font-size:1.05rem;cursor:pointer;box-shadow:0 2px 0 #23272e}
.pad button:active{transform:translateY(1px);box-shadow:none}
.pad .soft{background:#1d2127;font-size:.72rem;color:#9aa3ad}
.log{width:min(30rem,100%);font-family:ui-monospace,monospace;font-size:.7rem;color:#64748b;
 background:#0e1116;border:1px solid #1f2937;border-radius:.5rem;padding:.6rem;max-height:9rem;overflow:auto}
</style></head><body>
<div class="intro">
  <h1>Ssente Zaffe on a feature phone</h1>
  <p>No app, no data bundle, no smartphone. This handset speaks the real USSD protocol to the
  real gateway — each step resends the accumulated input, just as a telco does.</p>
</div>
<div class="phone">
  <div class="brand">SSENTE ZAFFE</div>
  <div class="screen" id="screen">Press DIAL to call *384#</div>
  <div class="count"><span id="session">no session</span><span id="chars"></span></div>
  <div class="entry">
    <input id="typed" placeholder="type letters or digits" autocomplete="off" aria-label="Keypad entry">
    <button id="send">Send</button>
  </div>
  <div class="pad">
    <button data-k="1">1</button><button data-k="2">2</button><button data-k="3">3</button>
    <button data-k="4">4</button><button data-k="5">5</button><button data-k="6">6</button>
    <button data-k="7">7</button><button data-k="8">8</button><button data-k="9">9</button>
    <button class="soft" id="dial">DIAL *384#</button><button data-k="0">0</button>
    <button class="soft" id="end">END</button>
  </div>
</div>
<div class="log" id="log">gateway traffic appears here</div>
<script>
const screenEl=document.getElementById('screen'),logEl=document.getElementById('log'),
 charsEl=document.getElementById('chars'),sessEl=document.getElementById('session'),
 typedEl=document.getElementById('typed');
let session=null,acc=[];
const log=m=>{logEl.textContent=m+"\n"+logEl.textContent;};
async function step(token){
  if(!session)return;
  if(token!==undefined&&token!=='')acc.push(token);
  const text=acc.join('*');
  const body=new URLSearchParams({sessionId:session,serviceCode:'*384#',phoneNumber:'+256700000000',text});
  log('POST / text="'+text+'"');
  let raw;
  try{raw=await (await fetch('/',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body})).text();}
  catch(e){screenEl.textContent='Network failure';return;}
  const end=raw.startsWith('END ');
  const payload=raw.replace(/^(CON|END) /,'');
  screenEl.textContent=payload;
  charsEl.textContent=payload.length+'/182 chars';
  charsEl.className=payload.length>182?'over':'';
  log('  <- '+raw.slice(0,4).trim()+' ('+payload.length+' chars)');
  if(end){log('session ended');session=null;acc=[];sessEl.textContent='no session';}
}
document.getElementById('dial').onclick=()=>{
  session='sim-'+Math.random().toString(36).slice(2,9);acc=[];
  sessEl.textContent='session '+session;log('DIAL *384# ('+session+')');step('');
};
document.getElementById('end').onclick=()=>{
  session=null;acc=[];screenEl.textContent='Call ended. Press DIAL to call *384#';
  sessEl.textContent='no session';charsEl.textContent='';log('user ended the call');
};
document.querySelectorAll('.pad button[data-k]').forEach(b=>b.onclick=()=>step(b.dataset.k));
const send=()=>{const v=typedEl.value.trim();if(v){typedEl.value='';step(v);}};
document.getElementById('send').onclick=send;
typedEl.addEventListener('keydown',e=>{if(e.key==='Enter')send();});
</script></body></html>`;
