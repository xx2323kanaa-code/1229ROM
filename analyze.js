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

  // ===== 動画準備 =====
  const video = document.createElement("video");
  video.src = URL.createObjectURL(file);
  await video.play();
  log(`video loaded (${video.duration.toFixed(2)}s)`);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const FPS = 2;
  let totalFrames = 0;
  let detectedFrames = 0;

  let MCP = [], PIP = [], DIP = [];

  // ===== MediaPipe =====
  const hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
  });
  hands.setOptions({ maxNumHands:1, modelComplexity:1 });

  hands.onResults(res=>{
    totalFrames++;
    if(!res.multiHandLandmarks) return;

    detectedFrames++;
    const lm = res.multiHandLandmarks[0];

    const PALM = lm[0];
    const MCPp = lm[17];
    const PIPp = lm[18];
    const DIPp = lm[19];
    const TIP  = lm[20];

    MCP.push(innerAngle3D(PALM, MCPp, PIPp));
    PIP.push(innerAngle3D(MCPp, PIPp, DIPp));
    DIP.push(innerAngle3D(PIPp, DIPp, TIP));
  });

  // ===== フレーム解析 =====
  let frameIndex = 0;
  for(let t=0; t<video.duration; t+=1/FPS){
    frameIndex++;
    log(`frame ${frameIndex}, seek ${t.toFixed(2)}s`);

    await seekVideo(video, t);
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video,0,0);

    log("hands.send start");
    await hands.send({image:canvas});
    log("hands.send done");
  }

  log(`frames done total=${totalFrames} detected=${detectedFrames}`);

  // ===== 品質チェック =====
  if(detectedFrames/totalFrames < 0.7){
    out.innerHTML = "⚠️ 小指が十分に写っていません（側面から撮影してください）";
    log("visibility low");
    return;
  }

  // ===== 屈曲角（臨床定義）=====
  const result = {
    MCP: 180 - Math.min(...MCP),
    PIP: 180 - Math.min(...PIP),
    DIP: 180 - Math.min(...DIP)
  };

  out.innerHTML = `
    <b>測定完了</b><br><br>
    MCP屈曲：${result.MCP.toFixed(1)}°<br>
    PIP屈曲：${result.PIP.toFixed(1)}°<br>
    DIP屈曲：${result.DIP.toFixed(1)}°
  `;

  log("analysis finished");
}

// ===== 3D内角計算（★最重要）=====
function innerAngle3D(a,b,c){
  const ab = {x:a.x-b.x, y:a.y-b.y, z:a.z-b.z};
  const cb = {x:c.x-b.x, y:c.y-b.y, z:c.z-b.z};
  const dot = ab.x*cb.x + ab.y*cb.y + ab.z*cb.z;
  const mag = Math.hypot(ab.x,ab.y,ab.z) * Math.hypot(cb.x,cb.y,cb.z);
  return Math.acos(dot/mag) * 180 / Math.PI;
}
