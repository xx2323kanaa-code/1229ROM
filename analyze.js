let DEBUG_LOG = [];
let hud;

function log(msg){
  const t = new Date().toLocaleTimeString();
  const line = `[${t}] ${msg}`;
  DEBUG_LOG.push(line);
  if (hud) hud.innerText = line;
}

function copyDebugLog(){
  navigator.clipboard.writeText(DEBUG_LOG.join("\n"));
  alert("ログをコピーしました");
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function seekVideo(video, time){
  return new Promise(resolve=>{
    const h = ()=>{ video.removeEventListener("seeked", h); resolve(); };
    video.addEventListener("seeked", h);
    video.currentTime = time;
  });
}

async function waitFrameReady(video, timeout=800){
  const t0 = performance.now();
  while(true){
    if(video.readyState >= 2 && video.videoWidth > 0) return true;
    if(performance.now() - t0 > timeout) return false;
    await sleep(16);
  }
}

// ===== ベクトル系 =====
const vec = (a,b)=>({x:b.x-a.x, y:b.y-a.y, z:(b.z||0)-(a.z||0)});
const dot = (a,b)=>a.x*b.x + a.y*b.y + a.z*b.z;
const norm = v=>Math.hypot(v.x,v.y,v.z);

function angleBetween(v1,v2){
  const d = dot(v1,v2) / (norm(v1)*norm(v2));
  if(!isFinite(d)) return null;
  const c = Math.max(-1, Math.min(1, d));
  return Math.acos(c) * 180/Math.PI;
}

// ===== 平面距離 =====
function pointPlaneDistance(p, a, b, c){
  const ab = vec(a,b), ac = vec(a,c);
  const n = {
    x: ab.y*ac.z - ab.z*ac.y,
    y: ab.z*ac.x - ab.x*ac.z,
    z: ab.x*ac.y - ab.y*ac.x
  };
  const ap = vec(a,p);
  return Math.abs(dot(ap,n)) / norm(n);
}

async function analyze(){
  hud = document.getElementById("hud");
  DEBUG_LOG=[];
  log("analyze() start");

  const out = document.getElementById("result");
  const file = document.getElementById("videoInput").files[0];
  if(!file){
    out.innerText="動画を選択してください";
    return;
  }

  const video=document.createElement("video");
  video.src=URL.createObjectURL(file);
  video.preload="auto";
  video.muted=true;
  video.playsInline=true;

  await new Promise(r=>video.onloadedmetadata=r);
  video.pause();
  log(`video loaded (${video.duration.toFixed(2)}s)`);

  const canvas=document.createElement("canvas");
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  canvas.width=video.videoWidth;
  canvas.height=video.videoHeight;

  const FPS=2;

  const data={
    ring:{MCP:[],PIP:[],DIP:[],dist:[]},
    pinky:{MCP:[],PIP:[],DIP:[],dist:[]}
  };

  const hands=new Hands({
    locateFile:f=>`https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
  });
  hands.setOptions({maxNumHands:1,modelComplexity:1,selfieMode:false});

  hands.onResults(res=>{
    if(!res.multiHandLandmarks) return;
    const lm=res.multiHandLandmarks[0];

    const WRIST=lm[0];
    const INDEX_MCP=lm[5];
    const MIDDLE_MCP=lm[9];
    const PINKY_MCP=lm[17];

    const denom=norm(vec(WRIST,MIDDLE_MCP));
    if(!isFinite(denom) || denom<=0) return;

    const palmPlane=[WRIST, INDEX_MCP, PINKY_MCP];

    const defs={
      ring:[13,14,15,16],
      pinky:[17,18,19,20]
    };

    for(const k of ["ring","pinky"]){
      const [mcp,pip,dip,tip]=defs[k];

      // MCP：MCP→PIP vs MCP→WRIST
      const mcpAngle = angleBetween(
        vec(lm[mcp], lm[pip]),
        vec(lm[mcp], WRIST)
      );

      // PIP：PIP→MCP vs PIP→DIP
      const pipAngle = angleBetween(
        vec(lm[pip], lm[mcp]),
        vec(lm[pip], lm[dip])
      );

      // DIP：DIP→PIP vs DIP→TIP
      const dipAngle = angleBetween(
        vec(lm[dip], lm[pip]),
        vec(lm[dip], lm[tip])
      );

      if(mcpAngle&&pipAngle&&dipAngle){
        data[k].MCP.push(mcpAngle);
        data[k].PIP.push(pipAngle);
        data[k].DIP.push(dipAngle);
      }

      const d = pointPlaneDistance(lm[tip], ...palmPlane) / denom;
      if(isFinite(d)) data[k].dist.push(d);
    }
  });

  for(let t=0;t<video.duration;t+=1/FPS){
    await seekVideo(video,t);
    if(!await waitFrameReady(video)) continue;
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    try{ await hands.send({image:canvas}); }
    catch{ log("hands.send failed"); }
  }

  function range(arr){
    if(arr.length<3) return null;
    return {flex:Math.max(...arr), ext:Math.min(...arr)};
  }

  let html="<b>測定完了</b><br><br>";
  for(const k of ["ring","pinky"]){
    const r=range(data[k].MCP);
    if(!r){ html+=`${k}: 測定不可<br><br>`; continue; }
    html+=`
<b>${k}</b><br>
MCP：屈曲 ${Math.max(...data[k].MCP).toFixed(1)}° / 伸展 ${Math.min(...data[k].MCP).toFixed(1)}°<br>
PIP：屈曲 ${Math.max(...data[k].PIP).toFixed(1)}° / 伸展 ${Math.min(...data[k].PIP).toFixed(1)}°<br>
DIP：屈曲 ${Math.max(...data[k].DIP).toFixed(1)}° / 伸展 ${Math.min(...data[k].DIP).toFixed(1)}°<br>
完全屈曲 指尖―手掌距離（正規化）： ${Math.min(...data[k].dist).toFixed(2)}
<br><br>`;
  }

  out.innerHTML=html;
  log("analysis finished");
}
