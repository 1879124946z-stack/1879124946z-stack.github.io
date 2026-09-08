"use strict";

const VERSION = "climb-flanker-1.1.0";
const PRACTICE_TRIALS = LabTask.debug ? 4 : 8;
const FORMAL_TRIALS = LabTask.debug ? 8 : 50;
const RESPONSE_DEADLINE_MS = LabTask.debug ? 900 : 2500;
const MIN_VALID_RT_MS = 200;
let rng;
const trialRows = [];
const formalRows = [];
let plannedTotal = PRACTICE_TRIALS + FORMAL_TRIALS;
let completed = 0;
let practiceAttempt = 0;

function arrow(direction) { return direction === "left" ? "←" : "→"; }

function stimulusHtml(target, flankers) {
  return `<div><div class="arrow-row" role="img" aria-label="中间箭头朝${target === "left" ? "左" : "右"}"><span>${arrow(flankers)}</span><span>${arrow(flankers)}</span><span class="target-arrow">${arrow(target)}</span><span>${arrow(flankers)}</span><span>${arrow(flankers)}</span></div><div class="target-caption">只看中间的<strong>蓝色箭头</strong></div></div>`;
}

function showInstructions() {
  LabTask.render(`<section class="intro-card"><h1>看中间，按方向</h1><p>屏幕上会出现5个大小一致的箭头。请忽略两边的箭头，只判断中间蓝色箭头朝哪边。</p><div class="flanker-demo"><div><strong>按左方向键</strong><div class="arrow-row"><span>→</span><span>→</span><span class="target-arrow">←</span><span>→</span><span>→</span></div></div><div class="demo-divider">或</div><div><strong>按右方向键</strong><div class="arrow-row"><span>←</span><span>←</span><span class="target-arrow">→</span><span>←</span><span>←</span></div></div></div><ul class="instruction-list"><li><span>1</span>又快又准确地作答。</li><li><span>2</span>使用键盘左右方向键，也可以点击屏幕下方按钮。</li><li><span>3</span>正式测试时不会提示对错。</li></ul><div class="button-row"><button id="begin" class="primary-button">开始练习</button><span class="quiet-note">练习通过后进入50题正式测试</span></div></section>`, "任务说明");
  document.getElementById("begin").addEventListener("click", runPractice);
}

function createBalancedTrials(count, block, practice = false, cellOffset = 0) {
  const trials = [];
  const cells = [
    { condition: "congruent", target_direction: "left", flanker_direction: "left" },
    { condition: "congruent", target_direction: "right", flanker_direction: "right" },
    { condition: "incongruent", target_direction: "left", flanker_direction: "right" },
    { condition: "incongruent", target_direction: "right", flanker_direction: "left" },
  ];
  for (let index = 0; index < count; index += 1) trials.push({ ...cells[(index + cellOffset) % cells.length], block, practice });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = LabTask.shuffle(trials, rng);
    const acceptable = candidate.every((trial, index) => index < 3 || candidate.slice(index - 3, index + 1).some((item) => item.condition !== trial.condition));
    if (acceptable) return candidate;
  }
  return LabTask.shuffle(trials, rng);
}

async function runPractice() {
  practiceAttempt += 1;
  const trials = createBalancedTrials(PRACTICE_TRIALS, "practice", true);
  const rows = await runSequence(trials, true);
  const accuracy = rows.filter((row) => row.correct === 1).length / rows.length;
  if (accuracy < .75) {
    if (practiceAttempt >= 2) return stopAfterPractice();
    plannedTotal += PRACTICE_TRIALS;
    LabTask.progress(completed, plannedTotal, Math.ceil((plannedTotal - completed) * 1.8));
    LabTask.render(`<section class="break-card"><h2>我们再练习一次</h2><p>只看中间蓝色大箭头。两边的小箭头可能会骗人。</p><button id="retry" class="primary-button">重新练习</button></section>`, "练习提示");
    document.getElementById("retry").addEventListener("click", runPractice);
    return;
  }
  showBreak(1);
}

function showBreak(blockNumber) {
  LabTask.render(`<section class="break-card"><h2>${blockNumber === 1 ? "练习完成" : "休息一下"}</h2><p>${blockNumber === 1 ? "接下来进入正式测试，不再提示对错。" : "眨眨眼、放松一下，准备好再继续。"}</p><button id="continue" class="primary-button">${blockNumber === 1 ? "开始正式测试" : "继续第2组"}</button></section>`, blockNumber === 1 ? "准备正式测试" : "组间休息");
  document.getElementById("continue").addEventListener("click", () => runFormalBlock(blockNumber));
}

async function runFormalBlock(blockNumber) {
  const count = Math.floor(FORMAL_TRIALS / 2);
  const rows = await runSequence(createBalancedTrials(count, `formal_${blockNumber}`, false, blockNumber - 1), false);
  formalRows.push(...rows);
  if (blockNumber === 1) return showBreak(2);
  finishTask();
}

async function runSequence(trials, practice) {
  const rows = [];
  for (let index = 0; index < trials.length; index += 1) {
    const trial = trials[index];
    const row = await runTrial(trial, index + 1, practice);
    rows.push(row); trialRows.push(row); completed += 1;
    LabTask.trial(row);
    const seconds = Math.ceil((plannedTotal - completed) * 1.8);
    LabTask.progress(completed, plannedTotal, seconds);
    await LabTask.sleep(LabTask.debug ? 60 : 500 + Math.floor(rng() * 301));
  }
  return rows;
}

async function runTrial(trial, blockTrial, practice) {
  LabTask.render(`<section class="test-panel" tabindex="-1"><div class="trial-header"><strong>${practice ? `练习 ${blockTrial}/${PRACTICE_TRIALS}` : "正式测试"}</strong><span>又快又准确</span></div><div class="stimulus-zone"><div class="fixation">+</div></div><div class="trial-footer"><button class="response-key" data-response="left">← 左</button><div class="feedback" aria-live="polite"></div><button class="response-key" data-response="right">右 →</button></div></section>`, practice ? "练习" : "正式测试");
  const panel = document.querySelector(".test-panel");
  panel.focus();
  await LabTask.sleep(LabTask.debug ? 70 : 500);
  document.querySelector(".stimulus-zone").innerHTML = `<div class="flanker-stimulus">${stimulusHtml(trial.target_direction, trial.flanker_direction)}</div>`;
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let settled = false;
    const priorFormalRows = trialRows.filter((row) => row.practice === 0);
    const previous = priorFormalRows[priorFormalRows.length - 1] || null;
    const finish = async (response) => {
      if (settled) return;
      settled = true;
      cleanup();
      const rt = response ? performance.now() - startedAt : null;
      const correct = Number(response === trial.target_direction);
      const row = {
        task_version: VERSION, block: trial.block, block_trial: blockTrial, practice: Number(practice), practice_attempt: practice ? practiceAttempt : 0,
        condition: trial.condition, target_direction: trial.target_direction, flanker_direction: trial.flanker_direction,
        correct_response: trial.target_direction, response: response || "", correct, rt_ms: LabTask.round(rt),
        timeout: Number(!response), anticipatory: Number(Number.isFinite(rt) && rt < MIN_VALID_RT_MS), valid_rt: Number(correct === 1 && Number.isFinite(rt) && rt >= MIN_VALID_RT_MS && rt <= RESPONSE_DEADLINE_MS),
        previous_condition: previous?.condition || "", previous_correct: previous?.correct ?? "", post_error: Number(previous?.correct === 0),
        response_deadline_ms: RESPONSE_DEADLINE_MS, trial_finished_at: new Date().toISOString(),
      };
      if (practice) {
        const feedback = document.querySelector(".feedback");
        feedback.className = `feedback ${!response ? "neutral" : correct ? "good" : "bad"}`;
        feedback.textContent = !response ? "请快一点" : correct ? "正确" : "只看中间";
        await LabTask.sleep(LabTask.debug ? 40 : 450);
      }
      resolve(row);
    };
    const keyHandler = (event) => { if (event.key === "ArrowLeft") void finish("left"); if (event.key === "ArrowRight") void finish("right"); };
    const clickHandler = (event) => void finish(event.currentTarget.dataset.response);
    const buttons = document.querySelectorAll("[data-response]");
    function cleanup() { clearTimeout(timer); window.removeEventListener("keydown", keyHandler); buttons.forEach((button) => button.removeEventListener("click", clickHandler)); }
    window.addEventListener("keydown", keyHandler);
    buttons.forEach((button) => button.addEventListener("click", clickHandler));
    const timer = setTimeout(() => void finish(null), RESPONSE_DEADLINE_MS);
  });
}

function summarizeCondition(condition) {
  const rows = formalRows.filter((row) => row.condition === condition);
  const valid = rows.filter((row) => row.valid_rt === 1);
  return { accuracy: rows.length ? rows.filter((row) => row.correct === 1).length / rows.length : null, medianRt: LabTask.median(valid.map((row) => row.rt_ms)), meanRt: LabTask.mean(valid.map((row) => row.rt_ms)) };
}

function finishTask() {
  LabTask.progress(plannedTotal, plannedTotal, 0);
  const congruent = summarizeCondition("congruent");
  const incongruent = summarizeCondition("incongruent");
  const validRows = formalRows.filter((row) => row.valid_rt === 1);
  const summary = {
    task_version: VERSION, completion_status: "complete", planned_formal_trials: FORMAL_TRIALS, completed_formal_trials: formalRows.length,
    overall_accuracy: LabTask.round(formalRows.filter((row) => row.correct === 1).length / formalRows.length, 4),
    congruent_accuracy: LabTask.round(congruent.accuracy, 4), incongruent_accuracy: LabTask.round(incongruent.accuracy, 4),
    accuracy_interference_pp: Number.isFinite(congruent.accuracy) && Number.isFinite(incongruent.accuracy) ? LabTask.round((congruent.accuracy - incongruent.accuracy) * 100) : null,
    congruent_median_correct_rt_ms: LabTask.round(congruent.medianRt), incongruent_median_correct_rt_ms: LabTask.round(incongruent.medianRt),
    rt_interference_ms: Number.isFinite(incongruent.medianRt) && Number.isFinite(congruent.medianRt) ? LabTask.round(incongruent.medianRt - congruent.medianRt) : null,
    overall_mean_correct_rt_ms: LabTask.round(LabTask.mean(validRows.map((row) => row.rt_ms))), rt_sd_ms: LabTask.round(LabTask.standardDeviation(validRows.map((row) => row.rt_ms))),
    timeout_count: formalRows.filter((row) => row.timeout === 1).length, anticipatory_count: formalRows.filter((row) => row.anticipatory === 1).length,
    rt_rule: `correct trials; ${MIN_VALID_RT_MS}-${RESPONSE_DEADLINE_MS} ms`, debug_mode: Number(LabTask.debug), finished_at: new Date().toISOString(),
  };
  LabTask.childCompletion();
  setTimeout(() => LabTask.complete(summary), 250);
}

function stopAfterPractice() {
  const summary = { task_version: VERSION, completion_status: "practice_fail", practice_attempts: practiceAttempt, debug_mode: Number(LabTask.debug), finished_at: new Date().toISOString() };
  LabTask.childCompletion("练习结束");
  setTimeout(() => LabTask.complete(summary, "stopped"), 250);
}

LabTask.onInit((_data) => {
  rng = LabTask.mulberry32(LabTask.seedFor(VERSION));
  LabTask.progress(0, plannedTotal, Math.ceil(plannedTotal * 1.8));
  showInstructions();
});
