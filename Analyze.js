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
  alert("デバッグログをコピーしました");
}

function seekVideo(video, time){
  return new Promise(resolve=>{
    const handler = ()=>{
      video.removeEventListener("seeked", handler);
      resolve();
    };
    video.addEventListener("seeked", handler);
    video.currentTime = time;
  });
}

// ===== 3D内角 =====
function innerAngle3D(a,b,c){
  const ab = {x:a.x-b.x, y:a.y-b.y, z:a.z-b.z};
  const cb = {x:c.x-b.x, y:c.y-b.y, z:c.z-b.z};
  const dot = ab.x*cb.x + ab.y*cb.y + ab.z*cb.z;
  const mag = Math.hypot(ab.x,ab.y,ab.z) * Math.hypot(cb.x,cb.y,cb.z);
  if(!isFinite(dot/mag)) return null;
  return Math.acos(dot/mag) * 180 / Math.PI;
}

async function analyze(){

  hud = document.getElementById("hud");
  log("analyze() start");

  const out = document.getElementById("result");
  const file = document.getElementById("videoInput").files[0];
  if(!file){
    out.innerText = "動画を選択してください";
    log("no file");
    return;
  }

  out.innerText = "解析中…";

  const video = document.createElement("video");
  video.src = URL.createObjectURL(file);
  await video.play();
  log(`video loaded (${video.duration.toFixed(2)}s)`);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const FPS = 2;

  // ===== 保存 =====
  let angles = { MCP:[], PIP:[], DIP:[] };
  let distances = [];

  let baseline = null;

  // ===== MediaPipe =====
  const hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
  });
  hands.setOptions({ maxNumHands:1, modelComplexity:1 });

  hands.onResults(res=>{
    if(!res.multiHandLandmarks) return;

    const lm = res.multiHandLandmarks[0];

    const WRIST = lm[0];
    const MCPp = lm[17];
    const PIPp = lm[18];
    const DIPp = lm[19];
    const TIP  = lm[20];
    const MID_MCP = lm[9]; // 正規化基準

    const aM = innerAngle3D(WRIST, MCPp, PIPp);
    const aP = innerAngle3D(MCPp, PIPp, DIPp);
    const aD = innerAngle3D(PIPp, DIPp, TIP);
    if(aM==null || aP==null || aD==null) return;

    // ===== baseline（最大伸展） =====
    if(!baseline){
      baseline = { MCP:aM, PIP:aP, DIP:aD };
      log("baseline captured");
    }

    angles.MCP.push(baseline.MCP - aM);
    angles.PIP.push(baseline.PIP - aP);
    angles.DIP.push(baseline.DIP - aD);

    const d = Math.hypot(
      TIP.x-WRIST.x,
      TIP.y-WRIST.y,
      (TIP.z||0)-(WRIST.z||0)
    );
    const norm = Math.hypot(
      MID_MCP.x-WRIST.x,
      MID_MCP.y-WRIST.y,
      (MID_MCP.z||0)-(WRIST.z||0)
    );
    if(isFinite(d/norm)) distances.push(d/norm);
  });

  // ===== フレーム処理 =====
  for(let t=0; t<video.duration; t+=1/FPS){
    log(`seek ${t.toFixed(2)}s`);
    await seekVideo(video, t);
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video,0,0);
    try{
      await hands.send({image:canvas});
    }catch{
      log("hands.send failed, skip frame");
    }
  }

  if(angles.MCP.length<3){
    out.innerText="⚠️ 指が十分に検出できませんでした";
    return;
  }

  const flex = arr => Math.max(...arr);
  const ext  = arr => Math.min(...arr);

  out.innerHTML = `
    <b>測定完了</b><br><br>

    MCP：屈曲 ${flex(angles.MCP).toFixed(1)}° /
    伸展 ${ext(angles.MCP).toFixed(1)}°<br>

    PIP：屈曲 ${flex(angles.PIP).toFixed(1)}° /
    伸展 ${ext(angles.PIP).toFixed(1)}°<br>

    DIP：屈曲 ${flex(angles.DIP).toFixed(1)}° /
    伸展 ${ext(angles.DIP).toFixed(1)}°<br>

    完全屈曲 指尖―手掌距離（正規化・無次元）：
    ${Math.min(...distances).toFixed(2)}
  `;

  log("analysis finished");
}
