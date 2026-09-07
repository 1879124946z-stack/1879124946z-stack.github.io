"use strict";

const VERSION = "climb-mot-1.0.0";
const OBJECT_COUNT = 8;
const TARGET_COUNT = 3;
const PRACTICE_TRIALS = 2;
const FORMAL_TRIALS = LabTask.debug ? 6 : 24;
const MOTION_MS = LabTask.debug ? 700 : 5000;
const CUE_MS = LabTask.debug ? 250 : 1500;
const SPEEDS = { slow: 90, medium: 130, fast: 170 };
const WIDTH = 900;
const HEIGHT = 520;
const RADIUS = 22;
let rng;
const rows = [];
const formalRows = [];
let completed = 0;
const plannedTotal = PRACTICE_TRIALS + FORMAL_TRIALS;
let formalTrials = [];

function showInstructions() {
  LabTask.render(`<section class="intro-card"><h1>盯住3个目标圆点</h1><p>开始时有3个圆点会变成橙色。请记住它们；所有圆点变成一样并开始移动后，用眼睛一直追踪这3个目标。</p><div class="mot-example"><span class="target"></span><span></span><span class="target"></span><span></span><span class="target"></span><span></span><p>橙色圆点是需要追踪的目标</p></div><ul class="instruction-list"><li><span>1</span>目标变回白色后，仍要一直盯住它们。</li><li><span>2</span>圆点停止后，点击你认为是目标的3个圆点。</li><li><span>3</span>选满3个后点击“确认选择”。</li></ul><div class="button-row"><button id="begin" class="primary-button">开始练习</button><span class="quiet-note">练习2题，正式测试24题</span></div></section>`, "任务说明");
  document.getElementById("begin").addEventListener("click", runPractice);
}

function createTrialOrder() {
  const labels = ["slow", "medium", "fast"];
  const trials = Array.from({ length: FORMAL_TRIALS }, (_, index) => ({ speedLevel: labels[index % labels.length], practice: false }));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = LabTask.shuffle(trials, rng);
    if (candidate.every((trial, index) => index < 2 || !(candidate[index - 1].speedLevel === trial.speedLevel && candidate[index - 2].speedLevel === trial.speedLevel))) return candidate;
  }
  return trials;
}

function initialObjects(speed) {
  const objects = [];
  let attempts = 0;
  while (objects.length < OBJECT_COUNT && attempts < 1000) {
    attempts += 1;
    const x = RADIUS + 18 + rng() * (WIDTH - (RADIUS + 18) * 2);
    const y = RADIUS + 18 + rng() * (HEIGHT - (RADIUS + 18) * 2);
    if (objects.some((item) => Math.hypot(item.x - x, item.y - y) < RADIUS * 3.2)) continue;
    const angle = rng() * Math.PI * 2;
    objects.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
  }
  return objects;
}

function targetSet() {
  return new Set(LabTask.shuffle(Array.from({ length: OBJECT_COUNT }, (_, index) => index), rng).slice(0, TARGET_COUNT));
}

function draw(canvas, objects, targets, mode, selected = new Set()) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = "#f8fafb"; context.fillRect(0, 0, WIDTH, HEIGHT);
  objects.forEach((object, index) => {
    const highlighted = mode === "cue" && targets.has(index);
    const chosen = mode === "select" && selected.has(index);
    context.beginPath(); context.arc(object.x, object.y, RADIUS, 0, Math.PI * 2);
    context.fillStyle = highlighted ? "#e59a5e" : chosen ? "#d9eee7" : "#ffffff";
    context.fill(); context.lineWidth = chosen ? 5 : 3;
    context.strokeStyle = highlighted ? "#9b5724" : chosen ? "#16735d" : "#173e5c"; context.stroke();
    if (mode === "select") {
      context.fillStyle = chosen ? "#12614f" : "#24445d";
      context.font = "700 18px Microsoft YaHei"; context.textAlign = "center"; context.textBaseline = "middle";
      context.fillText(String(index + 1), object.x, object.y + 1);
    }
  });
}

function moveObjects(objects, seconds) {
  objects.forEach((object) => {
    object.x += object.vx * seconds; object.y += object.vy * seconds;
    if (object.x <= RADIUS || object.x >= WIDTH - RADIUS) { object.x = Math.max(RADIUS, Math.min(WIDTH - RADIUS, object.x)); object.vx *= -1; }
    if (object.y <= RADIUS || object.y >= HEIGHT - RADIUS) { object.y = Math.max(RADIUS, Math.min(HEIGHT - RADIUS, object.y)); object.vy *= -1; }
  });
  for (let first = 0; first < objects.length; first += 1) {
    for (let second = first + 1; second < objects.length; second += 1) {
      const a = objects[first]; const b = objects[second]; const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance < RADIUS * 2 && distance > 0) {
        [a.vx, b.vx] = [b.vx, a.vx]; [a.vy, b.vy] = [b.vy, a.vy];
        const overlap = (RADIUS * 2 - distance) / 2; const nx = (a.x - b.x) / distance; const ny = (a.y - b.y) / distance;
        a.x += nx * overlap; a.y += ny * overlap; b.x -= nx * overlap; b.y -= ny * overlap;
      }
    }
  }
}

async function runPractice() {
  for (let index = 0; index < PRACTICE_TRIALS; index += 1) {
    const row = await runTrial({ speedLevel: "slow", practice: true }, index + 1, PRACTICE_TRIALS);
    rows.push(row); completed += 1; LabTask.trial(row); LabTask.progress(completed, plannedTotal, Math.ceil((plannedTotal - completed) * 10));
    await LabTask.sleep(LabTask.debug ? 80 : 700);
  }
  showFormalStart();
}

function showFormalStart() {
  formalTrials = createTrialOrder();
  LabTask.render(`<section class="break-card"><h2>练习完成</h2><p>正式测试有两组。圆点会以不同速度移动，请始终追踪最开始变成橙色的3个目标。</p><button id="continue" class="primary-button">开始正式测试</button></section>`, "准备正式测试");
  document.getElementById("continue").addEventListener("click", () => runFormal(0));
}

async function runFormal(startIndex) {
  const endIndex = startIndex === 0 ? Math.floor(FORMAL_TRIALS / 2) : FORMAL_TRIALS;
  for (let index = startIndex; index < endIndex; index += 1) {
    const row = await runTrial(formalTrials[index], index + 1, FORMAL_TRIALS);
    rows.push(row); formalRows.push(row); completed += 1; LabTask.trial(row); LabTask.progress(completed, plannedTotal, Math.ceil((plannedTotal - completed) * 10));
    await LabTask.sleep(LabTask.debug ? 80 : 650);
  }
  if (endIndex < FORMAL_TRIALS) {
    LabTask.render(`<section class="break-card"><h2>休息一下</h2><p>放松眼睛。准备好后继续完成第2组。</p><button id="continue" class="primary-button">继续第2组</button></section>`, "组间休息");
    document.getElementById("continue").addEventListener("click", () => runFormal(endIndex));
  } else finishTask();
}

async function runTrial(trial, trialNumber, totalInPhase) {
  const speed = SPEEDS[trial.speedLevel];
  const objects = initialObjects(speed); const targets = targetSet(); const selected = new Set();
  let visibilityInterruptions = 0; const visibilityHandler = () => { if (document.hidden) visibilityInterruptions += 1; };
  document.addEventListener("visibilitychange", visibilityHandler);
  LabTask.render(`<section class="mot-panel"><div class="trial-header"><strong>${trial.practice ? `练习 ${trialNumber}/${totalInPhase}` : `正式测试 ${trialNumber}/${totalInPhase}`}</strong><span>追踪3个目标</span></div><div class="mot-canvas-wrap"><canvas id="motCanvas" width="${WIDTH}" height="${HEIGHT}" aria-label="多目标追踪区域"></canvas></div><div class="mot-footer"><div class="mot-prompt">请看圆点</div><div class="mot-selection"></div><button id="confirm" class="primary-button" disabled>确认选择</button></div></section>`, trial.practice ? "练习" : "正式测试");
  const canvas = document.getElementById("motCanvas"); const prompt = document.querySelector(".mot-prompt"); const selection = document.querySelector(".mot-selection"); const confirm = document.getElementById("confirm");
  draw(canvas, objects, targets, "still"); await LabTask.sleep(LabTask.debug ? 100 : 700);
  prompt.textContent = "记住橙色目标"; draw(canvas, objects, targets, "cue"); await LabTask.sleep(CUE_MS);
  prompt.textContent = "请一直追踪目标"; draw(canvas, objects, targets, "move");
  const motionStart = performance.now();
  await new Promise((resolve) => {
    let previous = performance.now();
    const frame = (now) => {
      const elapsed = now - motionStart; const delta = Math.min(.035, (now - previous) / 1000); previous = now;
      moveObjects(objects, delta); draw(canvas, objects, targets, "move");
      if (elapsed < MOTION_MS) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
  prompt.textContent = "请选择3个目标"; selection.textContent = `已选择 0/${TARGET_COUNT}`; draw(canvas, objects, targets, "select", selected);
  const selectionStart = performance.now();
  const clickHandler = (event) => {
    const rect = canvas.getBoundingClientRect(); const x = (event.clientX - rect.left) * WIDTH / rect.width; const y = (event.clientY - rect.top) * HEIGHT / rect.height;
    let nearest = -1; let distance = Infinity;
    objects.forEach((object, index) => { const current = Math.hypot(object.x - x, object.y - y); if (current < distance) { distance = current; nearest = index; } });
    if (distance > RADIUS + 12) return;
    if (selected.has(nearest)) selected.delete(nearest); else if (selected.size < TARGET_COUNT) selected.add(nearest);
    selection.textContent = `已选择 ${selected.size}/${TARGET_COUNT}`; confirm.disabled = selected.size !== TARGET_COUNT; draw(canvas, objects, targets, "select", selected);
  };
  canvas.addEventListener("click", clickHandler);
  return new Promise((resolve) => {
    confirm.addEventListener("click", async () => {
      canvas.removeEventListener("click", clickHandler); document.removeEventListener("visibilitychange", visibilityHandler); confirm.disabled = true;
      const choices = Array.from(selected); const hits = choices.filter((index) => targets.has(index)).length;
      if (trial.practice) {
        prompt.textContent = hits === TARGET_COUNT ? "练习完成" : "记住最开始的橙色圆点";
        await LabTask.sleep(LabTask.debug ? 80 : 700);
      }
      resolve({
        task_version: VERSION, block: trial.practice ? "practice" : (trialNumber <= FORMAL_TRIALS / 2 ? "formal_1" : "formal_2"), block_trial: trial.practice ? trialNumber : ((trialNumber - 1) % (FORMAL_TRIALS / 2)) + 1, practice: Number(trial.practice),
        speed_level: trial.speedLevel, speed_px_per_s: speed, object_count: OBJECT_COUNT, target_count: TARGET_COUNT, motion_duration_ms: MOTION_MS,
        target_indices: Array.from(targets).sort((a, b) => a - b).map((index) => index + 1).join("-"), selected_indices: choices.sort((a, b) => a - b).map((index) => index + 1).join("-"),
        hits, false_alarms: TARGET_COUNT - hits, tracking_accuracy: LabTask.round(hits / TARGET_COUNT, 4), all_correct: Number(hits === TARGET_COUNT),
        selection_latency_ms: LabTask.round(performance.now() - selectionStart), visibility_interruptions: visibilityInterruptions, trial_finished_at: new Date().toISOString(),
      });
    });
  });
}

function speedSummary(level) {
  const subset = formalRows.filter((row) => row.speed_level === level);
  return { accuracy: LabTask.mean(subset.map((row) => row.tracking_accuracy)), perfect: LabTask.mean(subset.map((row) => row.all_correct)) };
}

function finishTask() {
  LabTask.progress(plannedTotal, plannedTotal, 0);
  const slow = speedSummary("slow"); const medium = speedSummary("medium"); const fast = speedSummary("fast");
  const summary = {
    task_version: VERSION, completion_status: "complete", completed_formal_trials: formalRows.length,
    overall_tracking_accuracy: LabTask.round(LabTask.mean(formalRows.map((row) => row.tracking_accuracy)), 4), overall_all_correct_rate: LabTask.round(LabTask.mean(formalRows.map((row) => row.all_correct)), 4),
    slow_tracking_accuracy: LabTask.round(slow.accuracy, 4), medium_tracking_accuracy: LabTask.round(medium.accuracy, 4), fast_tracking_accuracy: LabTask.round(fast.accuracy, 4),
    slow_all_correct_rate: LabTask.round(slow.perfect, 4), medium_all_correct_rate: LabTask.round(medium.perfect, 4), fast_all_correct_rate: LabTask.round(fast.perfect, 4),
    mean_selection_latency_ms: LabTask.round(LabTask.mean(formalRows.map((row) => row.selection_latency_ms))), total_visibility_interruptions: formalRows.reduce((sum, row) => sum + row.visibility_interruptions, 0),
    object_count: OBJECT_COUNT, target_count: TARGET_COUNT, motion_duration_ms: MOTION_MS, debug_mode: Number(LabTask.debug), finished_at: new Date().toISOString(),
  };
  LabTask.childCompletion(); setTimeout(() => LabTask.complete(summary), 250);
}

LabTask.onInit((_data) => {
  rng = LabTask.mulberry32(LabTask.seedFor(VERSION));
  LabTask.progress(0, plannedTotal, Math.ceil(plannedTotal * 10)); showInstructions();
});
