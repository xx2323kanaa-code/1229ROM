let DEBUG_LOG = [];
let hud;

function log(msg){
  const t = new Date().toLocaleTimeString();
  const line = `[${t}] ${msg}`;
  DEBUG_LOG.push(line);
  if (hud) hud.innerText = line;
}

function copyDebugLog(){
  const text = DEBUG_LOG.join("\n");
  navigator.clipboard.writeText(text);
  alert("デバッグログをコピーしました");
}

async function analyze(){

  hud = document.getElementById("hud");
  log("analyze() start");

  const out = document.getElementById("result");
  const file = document.getElementById("videoInput").files[0];
  if (!file){
    log("no video file");
    out.innerText = "動画を選択してください";
    return;
  }

  out.innerText = "解析中…（停止したらログをコピーしてください）";

  // ===== 動画 =====
  const video = document.createElement("video");
  video.src = URL.createObjectURL(file);
  await video.play();
  log(`video loaded, duration=${video.duration.toFixed(2)}s`);

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

  hands.onResults(res => {
    totalFrames++;
    if (!res.multiHandLandmarks) return;

    detectedFrames++;
    const lm = res.multiHandLandmarks[0];

    const PALM = lm[0];
    const MCPp = lm[17];
    const PIPp = lm[18];
    const DIPp = lm[19];
    const TIP  = lm[20];

    MCP.push(innerAngle(PALM, MCPp, PIPp));
    PIP.push(innerAngle(MCPp, PIPp, DIPp));
    DIP.push(innerAngle(PIPp, DIPp, TIP));
  });

  // ===== フレーム処理 =====
  let frameIndex = 0;
  for (let t = 0; t < video.duration; t += 1/FPS){
    frameIndex++;
    log(`frame ${frameIndex}, t=${t.toFixed(2)}s`);

    video.currentTime = t;
    await new Promise(r => setTimeout(r, 120));

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    log("hands.send start");
    await hands.send({ image: canvas });
    log("hands.send done");
  }

  log(`frames done: total=${totalFrames}, detected=${detectedFrames}`);

  // ===== 品質 =====
  const vis = detectedFrames / totalFrames;
  if (vis < 0.7){
    out.innerHTML = `
      <span style="color:#ffcc00">
      ⚠️ 小指が十分に見えていません。<br>
      側面から撮影してください。
      </span>`;
    log("visibility too low");
    return;
  }

  // ===== ★屈曲角の正規化（ここが修正点）=====
  // 内角：伸展≈180°, 屈曲ほど小
  // 臨床屈曲角 = 180 - 最小内角
  const res = {
    MCP: 180 - Math.min(...MCP),
    PIP: 180 - Math.min(...PIP),
    DIP: 180 - Math.min(...DIP)
  };

  out.innerHTML = `
    <span style="color:#66ff99"><b>測定完了</b></span><br><br>
    MCP屈曲：${res.MCP.toFixed(1)}°<br>
    PIP屈曲：${res.PIP.toFixed(1)}°<br>
    DIP屈曲：${res.DIP.toFixed(1)}°
  `;

  log("analysis finished");
}

// ===== 3点内角 =====
function innerAngle(a,b,c){
  const ab = {x:a.x-b.x, y:a.y-b.y};
  const cb = {x:c.x-b.x, y:c.y-b.y};
  const dot = ab.x*cb.x + ab.y*cb.y;
  const mag = Math.hypot(ab.x,ab.y)*Math.hypot(cb.x,cb.y);
  return Math.acos(dot/mag)*180/Math.PI;
}
