"use strict";

const VERSION = "climb-dccs-1.2.0";
const COUNTERBALANCE_SALT = "climb-dccs-mapping-v1";
const DEBUG = new URLSearchParams(location.search).get("debug") === "1";

const CONFIG = Object.freeze({
  fixationMs: DEBUG ? 120 : 400,
  cueMs: DEBUG ? 120 : 650,
  responseDeadlineMs: 3000,
  feedbackMs: DEBUG ? 80 : 650,
  itiMs: DEBUG ? 50 : 450,
  practiceTrials: DEBUG ? 2 : 5,
  preSwitchTrials: DEBUG ? 2 : 10,
  postSwitchTrials: DEBUG ? 2 : 10,
  mixedPracticeTrials: DEBUG ? 4 : 8,
  mixedTrialsPerBlock: DEBUG ? 6 : 15,
  mixedSwitchesPerBlock: DEBUG ? 2 : 5,
  maxRuleRun: 4,
  anticipatoryRtMs: 200,
  rtEligibilityAccuracy: 0.75,
  minCorrectSwitchRt: DEBUG ? 1 : 5,
  minCorrectRepeatRt: DEBUG ? 1 : 10,
});

const COLORS = Object.freeze({ orange: "#f2a900", blue: "#2f6fed" });
const STIMULI = Object.freeze([
  { id: "orange_triangle", color: "orange", shape: "triangle" },
  { id: "blue_circle", color: "blue", shape: "circle" },
]);

const app = document.getElementById("app");
const progressLabel = document.getElementById("progressLabel");
const taskProgress = document.getElementById("taskProgress");
const progressCount = document.getElementById("progressCount");
const progressRemaining = document.getElementById("progressRemaining");
const progressTime = document.getElementById("progressTime");
const progressTrack = taskProgress.querySelector("[role='progressbar']");
const progressFill = document.getElementById("progressFill");
document.getElementById("versionLabel").textContent = `${VERSION}${DEBUG ? " · 调试模式" : ""}`;

let participant = null;
let rng = Math.random;
let targetBySide = null;
let trials = [];
let trialRows = [];
let taskStarted = false;
let practiceAttempt = 0;
let mixedPracticeAttempt = 0;
let comprehensionFlag = false;
let summary = null;
let plannedTrialTotal = 0;
let extraPracticeAdded = false;

window.addEventListener("beforeunload", (event) => {
  if (taskStarted && !summary) {
    event.preventDefault();
    event.returnValue = "";
  }
});

function hashString(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function otherRule(rule) { return rule === "color" ? "shape" : "color"; }
function otherStimulus(index) { return index === 0 ? 1 : 0; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function percent(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—"; }
function round1(value) { return Number.isFinite(value) ? Math.round(value * 10) / 10 : null; }

function median(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const middle = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[middle] : (xs[middle - 1] + xs[middle]) / 2;
}

function mean(values) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null;
}

function setScreen(html, progress = "") {
  app.innerHTML = html;
  progressLabel.textContent = progress;
  window.scrollTo({ top: 0, behavior: "auto" });
}

function basePlannedTrialTotal() {
  return CONFIG.practiceTrials
    + CONFIG.preSwitchTrials
    + CONFIG.postSwitchTrials
    + CONFIG.mixedPracticeTrials
    + (CONFIG.mixedTrialsPerBlock * 2);
}

function setProgressVisible(visible) {
  taskProgress.hidden = !visible;
}

function formatRemainingTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (totalSeconds < 60) return `约${Math.max(1, totalSeconds)}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `约${minutes}分${seconds}秒` : `约${minutes}分钟`;
}

function updateTaskProgress(mode = "running") {
  if (!plannedTrialTotal) return;
  const completed = trialRows.length;
  const remaining = Math.max(0, plannedTrialTotal - completed);
  const proportion = mode === "complete" ? 1 : Math.min(1, completed / plannedTrialTotal);
  const observedDurations = trialRows.map((row) => row.trial_total_ms).filter(Number.isFinite);
  const observedMean = observedDurations.length >= 3 ? mean(observedDurations) : 2600;
  const estimatedTrialMs = Math.min(4500, Math.max(1500, observedMean));
  const transitionAllowanceMs = Math.ceil((remaining / plannedTrialTotal) * 45000);
  const estimateMs = (remaining * estimatedTrialMs) + transitionAllowanceMs;

  progressCount.textContent = mode === "stopped"
    ? `任务已停止 · 已完成 ${completed} 题`
    : `已完成 ${mode === "complete" ? plannedTrialTotal : completed}/${plannedTrialTotal} 题`;
  progressRemaining.textContent = mode === "complete" ? "剩余 0 题" : `剩余 ${remaining} 题`;
  progressTime.textContent = mode === "complete"
    ? "预计剩余时间：已完成"
    : mode === "stopped"
      ? "预计剩余时间：任务已结束"
      : `预计剩余时间：${formatRemainingTime(estimateMs)}${extraPracticeAdded ? "（含追加练习）" : ""}`;
  progressFill.style.width = `${Math.round(proportion * 1000) / 10}%`;
  progressTrack.setAttribute("aria-valuenow", String(Math.round(proportion * 100)));
  progressTrack.setAttribute("aria-valuetext", `${progressCount.textContent}，${progressRemaining.textContent}`);
  window.parent.postMessage({
    type: "TASK_PROGRESS",
    completed,
    total: plannedTrialTotal,
    remaining,
    estimatedSeconds: Math.ceil(estimateMs / 1000),
  }, "*");
}

function stimulusSvg(stimulus, label = "刺激图形") {
  const fill = COLORS[stimulus.color];
  const shape = stimulus.shape === "circle"
    ? `<circle cx="60" cy="60" r="42" fill="${fill}" stroke="#233247" stroke-width="3"/>`
    : `<polygon points="60,14 108,102 12,102" fill="${fill}" stroke="#233247" stroke-width="3" stroke-linejoin="round"/>`;
  return `<svg class="shape-svg" viewBox="0 0 120 120" role="img" aria-label="${label}">${shape}</svg>`;
}

function targetsHtml() {
  const left = targetBySide.left;
  const right = targetBySide.right;
  return `
    <div class="target-row" aria-label="目标卡片">
      <div class="target-card left">${stimulusSvg(left, "左侧目标卡")}
        <div class="key-label">← 左方向键</div>
      </div>
      <div class="target-card right"><div class="key-label">右方向键 →</div>
        ${stimulusSvg(right, "右侧目标卡")}
      </div>
    </div>`;
}

function initializeParticipant(data) {
  const id = String(data.participantId || data.participant_id || "").trim().replace(/\s+/g, "_");
  if (!id) return;
  const session = data.session || "pre";
  const stableSeed = hashString(`${id}|${COUNTERBALANCE_SALT}`);
  const sessionSeed = hashString(`${id}|${session}|${VERSION}`);
  participant = {
    participant_id: id,
    session,
    age: Number(data.age || 8),
    sex: data.sex || "prefer_not",
    assessor_id: String(data.assessorId || data.assessor_id || "").trim(),
    device_id: String(data.deviceId || data.device_id || "").trim(),
    stable_seed: stableSeed,
    session_seed: sessionSeed,
    started_at: new Date().toISOString(),
  };
  rng = mulberry32(sessionSeed);
  const leftFirst = stableSeed % 2 === 0;
  const targetA = { id: "orange_circle", color: "orange", shape: "circle" };
  const targetB = { id: "blue_triangle", color: "blue", shape: "triangle" };
  targetBySide = leftFirst ? { left: targetA, right: targetB } : { left: targetB, right: targetA };
  participant.target_mapping = `${targetBySide.left.id}_left`;
  participant.initial_rule = stableSeed % 4 < 2 ? "color" : "shape";
  instructionScreen();
}

function setupScreen() {
  setProgressVisible(false);
  setScreen(`
    <section class="card">
      <h1>儿童高级/混合版 DCCS</h1>
      <p class="lead">适用于本研究7—9岁儿童的认知灵活性测验。预计正式测试约8—10分钟。</p>
      <form id="setupForm" class="form-grid">
        <label>儿童研究编号（不得填写姓名）
          <input id="participantId" autocomplete="off" required placeholder="例如 HZ001">
        </label>
        <label>测试时间
          <select id="session" required>
            <option value="pre">前测</option>
            <option value="post">后测</option>
          </select>
        </label>
        <label>年龄
          <select id="age" required>
            <option value="7">7岁</option><option value="8">8岁</option><option value="9">9岁</option>
          </select>
        </label>
        <label>性别
          <select id="sex" required>
            <option value="boy">男</option><option value="girl">女</option>
            <option value="other">其他</option><option value="prefer_not">不愿说明</option>
          </select>
        </label>
        <label>测试员编号
          <input id="assessorId" autocomplete="off" placeholder="例如 A01">
        </label>
        <label>设备编号
          <input id="deviceId" autocomplete="off" placeholder="例如 PC01">
        </label>
        <label class="consent-row">
          <input id="consent" type="checkbox" required>
          <span>已确认监护人知情同意、儿童同意参加，并已完成测试前标准化说明。</span>
        </label>
        <div class="actions">
          <button class="button" type="submit">进入任务说明</button>
        </div>
      </form>
      <p class="notice">建议：使用同一台电脑、同一浏览器和外接键盘；给左右方向键贴上明显箭头；前测和后测保持相同测试环境。</p>
    </section>`, "研究者设置");

  document.getElementById("setupForm").addEventListener("submit", (event) => {
    event.preventDefault();
    initializeParticipant({
      participantId: document.getElementById("participantId").value,
      session: document.getElementById("session").value,
      age: document.getElementById("age").value,
      sex: document.getElementById("sex").value,
      assessorId: document.getElementById("assessorId").value,
      deviceId: document.getElementById("deviceId").value,
    });
  });
}

function instructionScreen() {
  setProgressVisible(false);
  const firstName = participant.initial_rule === "color" ? "颜色" : "形状";
  const secondName = participant.initial_rule === "color" ? "形状" : "颜色";
  setScreen(`
    <section class="card">
      <h2>给小朋友的说明</h2>
      <p>屏幕下方一直有两张目标卡，中间会出现一张新卡。请按照屏幕上方提示的游戏规则，把中间的卡片送到左边或右边。</p>
      <div class="protocol-grid">
        <div class="protocol-step">练习<br>${firstName}游戏</div>
        <div class="protocol-step">前转换<br>单一规则</div>
        <div class="protocol-step">后转换<br>${secondName}游戏</div>
        <div class="protocol-step">混合阶段<br>看提示换规则</div>
      </div>
      <div class="rule-demo">
        <div class="rule-name">颜色：找相同颜色　｜　形状：找相同形状</div>
        <p>按键只有两个：← 选择左边，→ 选择右边。又快又准确，但准确最重要。</p>
      </div>
      <p class="notice warning">测试员：请让儿童复述两条规则。练习阶段有反馈，正式阶段没有反馈。不要在正式试次中提示答案。</p>
      <div class="actions center"><button id="beginButton" class="button">开始练习</button></div>
    </section>`, "任务说明");

  document.getElementById("beginButton").addEventListener("click", async () => {
    taskStarted = true;
    if (!DEBUG) {
      try { await document.documentElement.requestFullscreen?.(); } catch (_) { /* Fullscreen is optional. */ }
    }
    await startProtocol();
  }, { once: true });
}

function sideFor(stimulus, rule) {
  const left = targetBySide.left;
  const matchesLeft = rule === "color" ? stimulus.color === left.color : stimulus.shape === left.shape;
  return matchesLeft ? "left" : "right";
}

function balancedStimulusIndices(count) {
  const values = Array.from({ length: count }, (_, index) => index % 2);
  return shuffle(values);
}

function makeSingleRuleTrials(rule, count, block, practice = false, attempt = 1) {
  return balancedStimulusIndices(count).map((stimulusIndex, index) => ({
    block,
    block_trial: index + 1,
    rule,
    is_switch: null,
    response_transition: null,
    stimulus_transition: null,
    stimulus_index: stimulusIndex,
    practice,
    practice_attempt: practice ? attempt : null,
  }));
}

function makeRuleSequence(startRule, length, switchCount) {
  if (length < 2) return [startRule];
  const transitionPositions = Array.from({ length: length - 1 }, (_, index) => index + 1);
  for (let attempt = 0; attempt < 5000; attempt += 1) {
    const switches = new Set(shuffle(transitionPositions).slice(0, switchCount));
    const rules = [startRule];
    let maxRun = 1;
    let run = 1;
    for (let index = 1; index < length; index += 1) {
      const next = switches.has(index) ? otherRule(rules[index - 1]) : rules[index - 1];
      rules.push(next);
      run = next === rules[index - 1] ? run + 1 : 1;
      maxRun = Math.max(maxRun, run);
    }
    if (maxRun <= CONFIG.maxRuleRun) return rules;
  }
  throw new Error("无法生成符合最大连续规则限制的混合序列。");
}

function makeMixedBlock(blockNumber, startRule, count, switchCount, practice = false, attempt = 1) {
  const rules = makeRuleSequence(startRule, count, Math.min(switchCount, Math.max(0, count - 1)));
  const transitionTypes = rules.slice(1).map((rule, index) => rule === rules[index] ? "repeat" : "switch");
  const desiredByType = {};
  ["switch", "repeat"].forEach((type) => {
    const n = transitionTypes.filter((value) => value === type).length;
    desiredByType[type] = shuffle(Array.from({ length: n }, (_, index) => index % 2 === 0 ? "response_repeat" : "response_switch"));
  });

  const stimulusIndices = [Math.floor(rng() * 2)];
  const responseTransitions = [null];
  for (let index = 1; index < count; index += 1) {
    const transitionType = transitionTypes[index - 1];
    const desired = desiredByType[transitionType].pop();
    const ruleSwitched = transitionType === "switch";
    const wantSameResponse = desired === "response_repeat";
    const keepStimulus = ruleSwitched ? !wantSameResponse : wantSameResponse;
    stimulusIndices.push(keepStimulus ? stimulusIndices[index - 1] : otherStimulus(stimulusIndices[index - 1]));
    responseTransitions.push(desired);
  }

  return rules.map((rule, index) => ({
    block: practice ? "mixed_practice" : `mixed_${blockNumber}`,
    block_trial: index + 1,
    rule,
    is_switch: index === 0 ? null : transitionTypes[index - 1] === "switch",
    response_transition: responseTransitions[index],
    stimulus_transition: index === 0 ? null : (stimulusIndices[index] === stimulusIndices[index - 1] ? "repeat" : "switch"),
    stimulus_index: stimulusIndices[index],
    practice,
    practice_attempt: practice ? attempt : null,
  }));
}

function blockIntro(title, copy, buttonText = "继续") {
  return new Promise((resolve) => {
    setScreen(`
      <section class="card">
        <h2>${title}</h2>
        <p>${copy}</p>
        <p class="notice">把双手轻放在方向键附近。先看上方规则，再看中间卡片。</p>
        <div class="actions center"><button id="continueButton" class="button">${buttonText}</button></div>
      </section>`, title);
    document.getElementById("continueButton").addEventListener("click", resolve, { once: true });
  });
}

async function startProtocol() {
  plannedTrialTotal = basePlannedTrialTotal();
  extraPracticeAdded = false;
  setProgressVisible(true);
  updateTaskProgress();
  const firstRule = participant.initial_rule;
  const secondRule = otherRule(firstRule);
  const firstName = firstRule === "color" ? "颜色" : "形状";
  const secondName = secondRule === "color" ? "颜色" : "形状";

  await blockIntro(`${firstName}游戏练习`, `先只玩${firstName}游戏。每题后会告诉你是否正确。`, "开始练习");
  practiceAttempt = 1;
  let practiceRows = await runSequence(makeSingleRuleTrials(firstRule, CONFIG.practiceTrials, "initial_practice", true, practiceAttempt));
  let practiceAccuracy = mean(practiceRows.map((row) => row.correct));
  if (practiceAccuracy <= 0.20) {
    practiceAttempt = 2;
    plannedTrialTotal += CONFIG.practiceTrials;
    extraPracticeAdded = true;
    updateTaskProgress();
    await blockIntro("再练习一次", `我们再练习一次${firstName}游戏。请记住：只看${firstName}。`, "重新练习");
    practiceRows = await runSequence(makeSingleRuleTrials(firstRule, CONFIG.practiceTrials, "initial_practice", true, practiceAttempt));
    practiceAccuracy = mean(practiceRows.map((row) => row.correct));
    if (practiceAccuracy <= 0.20) {
      comprehensionFlag = true;
      return finishTask("practice_fail");
    }
  }

  await blockIntro("前转换阶段", `继续玩${firstName}游戏。接下来不再提示对错。`, "开始正式测试");
  await runSequence(makeSingleRuleTrials(firstRule, CONFIG.preSwitchTrials, "pre_switch"));

  await blockIntro("规则改变", `现在改玩${secondName}游戏。刚才的规则不再使用，请只按照${secondName}选择。`, "开始新规则");
  await runSequence(makeSingleRuleTrials(secondRule, CONFIG.postSwitchTrials, "post_switch"));

  await blockIntro("混合游戏练习", "从现在开始，每题上方都会提示“颜色”或“形状”。规则可能保持，也可能改变。练习题仍会提示对错。", "开始混合练习");
  mixedPracticeAttempt = 1;
  let mixedPractice = await runSequence(makeMixedBlock(0, firstRule, CONFIG.mixedPracticeTrials, Math.max(1, Math.floor((CONFIG.mixedPracticeTrials - 1) / 2)), true, mixedPracticeAttempt));
  let mixedPracticeAccuracy = mean(mixedPractice.map((row) => row.correct));
  if (mixedPracticeAccuracy < 0.50) {
    mixedPracticeAttempt = 2;
    plannedTrialTotal += CONFIG.mixedPracticeTrials;
    extraPracticeAdded = true;
    updateTaskProgress();
    await blockIntro("再练习一次混合游戏", "每题都先看规则提示：颜色就找相同颜色，形状就找相同形状。", "重新练习");
    mixedPractice = await runSequence(makeMixedBlock(0, secondRule, CONFIG.mixedPracticeTrials, Math.max(1, Math.floor((CONFIG.mixedPracticeTrials - 1) / 2)), true, mixedPracticeAttempt));
    mixedPracticeAccuracy = mean(mixedPractice.map((row) => row.correct));
    if (mixedPracticeAccuracy <= 0.25) comprehensionFlag = true;
  }

  await blockIntro("混合阶段（第1组）", "接下来没有对错提示。请保持准确，同时尽快作答。", "开始第1组");
  await runSequence(makeMixedBlock(1, firstRule, CONFIG.mixedTrialsPerBlock, CONFIG.mixedSwitchesPerBlock));

  await blockIntro("休息一下", "可以放松眼睛和双手。准备好后继续完成最后一组。", "开始第2组");
  await runSequence(makeMixedBlock(2, secondRule, CONFIG.mixedTrialsPerBlock, CONFIG.mixedSwitchesPerBlock));

  finishTask("complete");
}

async function runSequence(sequence) {
  const rows = [];
  for (let index = 0; index < sequence.length; index += 1) {
    const trial = { ...sequence[index], global_trial: trials.length + 1 };
    trials.push(trial);
    progressLabel.textContent = `${humanBlock(trial.block)} · ${index + 1}/${sequence.length}`;
    updateTaskProgress();
    const row = await runTrial(trial);
    rows.push(row);
    trialRows.push(row);
    window.parent.postMessage({ type: "TRIAL_DATA", trial: row }, "*");
    updateTaskProgress();
  }
  return rows;
}

function humanBlock(block) {
  return ({
    initial_practice: "规则练习",
    pre_switch: "前转换",
    post_switch: "后转换",
    mixed_practice: "混合练习",
    mixed_1: "混合第1组",
    mixed_2: "混合第2组",
  })[block] || block;
}

function taskShell(rule, stimulusMarkup = "") {
  const cueText = rule === "color" ? "颜色" : "形状";
  const cueClass = rule === "color" ? "color-rule" : "shape-rule";
  setScreen(`
    <section id="taskShell" class="task-shell" tabindex="-1">
      ${DEBUG ? `<div class="debug-controls" aria-label="调试控制"><button type="button" data-debug-side="left">模拟左键</button><button type="button" data-debug-side="right">模拟右键</button></div>` : ""}
      <div id="cue" class="cue ${cueClass}">${cueText}</div>
      <div id="stimulusArea" class="stimulus-area">${stimulusMarkup}</div>
      ${targetsHtml()}
    </section>`, progressLabel.textContent);
  document.getElementById("taskShell").focus({ preventScroll: true });
}

async function runTrial(trial) {
  const trialStartedAt = performance.now();
  const stimulus = STIMULI[trial.stimulus_index];
  const correctSide = sideFor(stimulus, trial.rule);

  taskShell(trial.rule, `<div class="fixation" aria-label="注视点">+</div>`);
  document.getElementById("cue").style.visibility = "hidden";
  await sleep(CONFIG.fixationMs);
  document.getElementById("cue").style.visibility = "visible";
  document.getElementById("stimulusArea").innerHTML = "";
  await sleep(CONFIG.cueMs);

  const stimulusArea = document.getElementById("stimulusArea");
  stimulusArea.innerHTML = `<div class="stimulus-card">${stimulusSvg(stimulus, "需要分类的卡片")}</div>`;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const onset = performance.now();
  const response = await waitForArrowResponse(CONFIG.responseDeadlineMs);
  const rt = response ? performance.now() - onset : null;
  const responseSide = response?.key === "ArrowLeft" ? "left" : response?.key === "ArrowRight" ? "right" : null;
  const correct = responseSide === correctSide ? 1 : 0;
  const timeout = responseSide === null ? 1 : 0;
  const validRt = Number.isFinite(rt) && rt >= CONFIG.anticipatoryRtMs && rt <= CONFIG.responseDeadlineMs;

  const row = {
    task_version: VERSION,
    participant_id: participant.participant_id,
    session: participant.session,
    age: participant.age,
    sex: participant.sex,
    assessor_id: participant.assessor_id,
    device_id: participant.device_id,
    stable_seed: participant.stable_seed,
    session_seed: participant.session_seed,
    target_mapping: participant.target_mapping,
    initial_rule: participant.initial_rule,
    global_trial: trial.global_trial,
    block: trial.block,
    block_trial: trial.block_trial,
    practice: trial.practice ? 1 : 0,
    practice_attempt: trial.practice_attempt,
    rule: trial.rule,
    is_switch: trial.is_switch === null ? "" : Number(trial.is_switch),
    response_transition: trial.response_transition || "",
    stimulus_transition: trial.stimulus_transition || "",
    stimulus_id: stimulus.id,
    stimulus_color: stimulus.color,
    stimulus_shape: stimulus.shape,
    correct_side: correctSide,
    response_side: responseSide || "",
    correct,
    rt_ms: round1(rt),
    valid_rt: Number(validRt),
    timeout,
    trial_finished_at: new Date().toISOString(),
  };

  if (trial.practice) {
    stimulusArea.innerHTML = correct
      ? `<div class="feedback correct">✓ 正确</div>`
      : `<div class="feedback incorrect">${timeout ? "时间到" : "再仔细看规则"}</div>`;
    await sleep(CONFIG.feedbackMs);
  }
  stimulusArea.innerHTML = "";
  await sleep(CONFIG.itiMs);
  row.trial_total_ms = round1(performance.now() - trialStartedAt);
  return row;
}

function waitForArrowResponse(deadlineMs) {
  return new Promise((resolve) => {
    let settled = false;
    const debugButtons = DEBUG ? Array.from(document.querySelectorAll("[data-debug-side]")) : [];
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown, true);
      debugButtons.forEach((button) => button.removeEventListener("click", onDebugClick));
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.repeat || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      finish({ key: event.key });
    };
    const onDebugClick = (event) => {
      const side = event.currentTarget.dataset.debugSide;
      finish({ key: side === "left" ? "ArrowLeft" : "ArrowRight" });
    };
    const timer = setTimeout(() => finish(null), deadlineMs);
    window.addEventListener("keydown", onKeyDown, true);
    debugButtons.forEach((button) => button.addEventListener("click", onDebugClick));
  });
}

function validCorrectRtRows(rows) {
  return rows.filter((row) => row.correct === 1 && row.valid_rt === 1 && !row.practice);
}

function accuracy(rows) {
  return mean(rows.map((row) => row.correct));
}

function accuracyPercent(rows) {
  const value = accuracy(rows);
  return Number.isFinite(value) ? round1(value * 100) : null;
}

function computeSummary(status) {
  const testRows = trialRows.filter((row) => !row.practice);
  const pre = testRows.filter((row) => row.block === "pre_switch");
  const post = testRows.filter((row) => row.block === "post_switch");
  const mixed = testRows.filter((row) => row.block.startsWith("mixed_"));
  const mixedSwitch = mixed.filter((row) => row.is_switch === 1);
  const mixedRepeat = mixed.filter((row) => row.is_switch === 0);
  const switchRtRows = validCorrectRtRows(mixedSwitch);
  const repeatRtRows = validCorrectRtRows(mixedRepeat);
  const singleRtRows = validCorrectRtRows([...pre, ...post]);
  const mixedAccuracy = accuracy(mixed);
  const switchAccuracy = accuracy(mixedSwitch);
  const repeatAccuracy = accuracy(mixedRepeat);
  const switchRt = median(switchRtRows.map((row) => row.rt_ms));
  const repeatRt = median(repeatRtRows.map((row) => row.rt_ms));
  const singleRt = median(singleRtRows.map((row) => row.rt_ms));
  const rtEligible = Number.isFinite(mixedAccuracy)
    && mixedAccuracy >= CONFIG.rtEligibilityAccuracy
    && switchRtRows.length >= CONFIG.minCorrectSwitchRt
    && repeatRtRows.length >= CONFIG.minCorrectRepeatRt;

  return {
    task_version: VERSION,
    participant_id: participant.participant_id,
    session: participant.session,
    age: participant.age,
    sex: participant.sex,
    assessor_id: participant.assessor_id,
    device_id: participant.device_id,
    stable_seed: participant.stable_seed,
    session_seed: participant.session_seed,
    target_mapping: participant.target_mapping,
    initial_rule: participant.initial_rule,
    status,
    comprehension_flag: Number(comprehensionFlag),
    started_at: participant.started_at,
    finished_at: new Date().toISOString(),
    planned_trial_total: plannedTrialTotal,
    completed_all_trial_rows: trialRows.length,
    extra_practice_added: Number(extraPracticeAdded),
    mean_trial_total_ms: round1(mean(trialRows.map((row) => row.trial_total_ms))),
    completed_test_trials: testRows.length,
    pre_switch_accuracy: accuracyPercent(pre),
    post_switch_accuracy: accuracyPercent(post),
    post_switch_errors: post.filter((row) => row.correct === 0).length,
    mixed_accuracy_primary: accuracyPercent(mixed),
    mixed_switch_accuracy: accuracyPercent(mixedSwitch),
    mixed_repeat_accuracy: accuracyPercent(mixedRepeat),
    accuracy_switch_cost_pp: Number.isFinite(switchAccuracy) && Number.isFinite(repeatAccuracy)
      ? round1((repeatAccuracy - switchAccuracy) * 100)
      : null,
    mixed_correct_median_rt_ms: round1(median(validCorrectRtRows(mixed).map((row) => row.rt_ms))),
    switch_correct_median_rt_ms: round1(switchRt),
    repeat_correct_median_rt_ms: round1(repeatRt),
    single_rule_correct_median_rt_ms: round1(singleRt),
    rt_switch_cost_ms: rtEligible ? round1(switchRt - repeatRt) : null,
    rt_mixing_cost_ms: rtEligible && Number.isFinite(singleRt) ? round1(repeatRt - singleRt) : null,
    rt_analysis_eligible: Number(rtEligible),
    rt_eligibility_rule: `mixed_accuracy>=${CONFIG.rtEligibilityAccuracy}; correct_switch>=${CONFIG.minCorrectSwitchRt}; correct_repeat>=${CONFIG.minCorrectRepeatRt}`,
    anticipatory_rt_cutoff_ms: CONFIG.anticipatoryRtMs,
    response_deadline_ms: CONFIG.responseDeadlineMs,
    timeout_count: testRows.filter((row) => row.timeout === 1).length,
    invalid_rt_count: testRows.filter((row) => row.valid_rt === 0 && row.timeout === 0).length,
    debug_mode: Number(DEBUG),
    browser_user_agent: navigator.userAgent,
  };
}

function finishTask(status) {
  summary = computeSummary(status);
  taskStarted = false;
  updateTaskProgress(status === "complete" ? "complete" : "stopped");
  const exitPromise = document.exitFullscreen?.();
  if (exitPromise?.catch) exitPromise.catch(() => {});
  setScreen(`<section class="card"><h2>${status === "complete" ? "测试已完成，感谢参与" : "本次测试未完成"}</h2><p>请返回项目列表继续。</p></section>`, "任务结束");
  window.parent.postMessage({ type: "TASK_COMPLETE", summary, status }, "*");
}

if (window.parent === window) location.replace("/");

window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "TASK_INIT" || taskStarted || participant) return;
  initializeParticipant(event.data.payload || {});
});

window.parent.postMessage({ type: "TASK_READY", version: VERSION }, "*");
