"use strict";

const VERSION = "climb-corsi-1.1.0";
const MIN_SPAN = 2;
const MAX_SPAN = LabTask.debug ? 4 : 9;
const TRIALS_PER_LEVEL = 2;
const FLASH_MS = LabTask.debug ? 120 : 700;
const GAP_MS = LabTask.debug ? 60 : 300;
const POSITIONS = [
  [8, 13], [35, 7], [70, 14], [20, 39], [54, 34], [83, 45], [6, 70], [42, 73], [72, 78],
];
let rng;
const rows = [];
let completed = 0;
const plannedTotal = 2 + ((MAX_SPAN - MIN_SPAN + 1) * TRIALS_PER_LEVEL * 2);
let phaseOrder = [];

function boardHtml(interactive = false, compact = false) {
  return `<div class="${compact ? "corsi-preview" : "corsi-board"}" role="group" aria-label="九个位置不规则排列的数字方块">${POSITIONS.map(([left, top], index) => `<${interactive ? "button" : "div"} class="corsi-block" data-block="${index}" style="left:${left}%;top:${top}%" ${interactive ? `type="button" aria-label="位置${index + 1}"` : ""}>${index + 1}</${interactive ? "button" : "div"}>`).join("")}</div>`;
}

function showInstructions() {
  LabTask.render(`<section class="intro-card"><h1>记住方块亮起的顺序</h1><p>九个方块会一个接一个亮起。全部亮完后，请按要求依次点击方块。</p>${boardHtml(false, true)}<ul class="instruction-list"><li><span>1</span>“顺序”阶段：按亮起的先后顺序点击。</li><li><span>2</span>“倒序”阶段：从最后亮起的方块开始，反着点击。</li><li><span>3</span>方块会越来越多，没记住也不用担心。</li></ul><div class="button-row"><button id="begin" class="primary-button">开始练习</button><span class="quiet-note">先练习顺序与倒序各1题</span></div></section>`, "任务说明");
  document.getElementById("begin").addEventListener("click", runPractice);
}

function makeSequence(length) {
  const result = [];
  while (result.length < length) {
    const candidate = Math.floor(rng() * POSITIONS.length);
    if (!result.includes(candidate)) result.push(candidate);
  }
  return result;
}

async function runPractice() {
  for (const phase of ["forward", "backward"]) {
    const sequence = makeSequence(2);
    const row = await runTrial({ phase, sequence, levelTrial: 1, practice: true });
    rows.push(row); completed += 1; LabTask.trial(row); LabTask.progress(completed, plannedTotal, Math.ceil((plannedTotal - completed) * 8));
  }
  const stableSeed = LabTask.seedFor(`${VERSION}|order`, true);
  phaseOrder = stableSeed % 2 === 0 ? ["forward", "backward"] : ["backward", "forward"];
  showPhaseIntro(0);
}

function phaseName(phase) { return phase === "forward" ? "顺序" : "倒序"; }

function showPhaseIntro(index) {
  const phase = phaseOrder[index];
  LabTask.render(`<section class="break-card"><h2>${phaseName(phase)}阶段</h2><p>${phase === "forward" ? "请按方块亮起的先后顺序点击。" : "请从最后亮起的方块开始，反着点击。"}</p><button id="continue" class="primary-button">开始${phaseName(phase)}测试</button></section>`, `${phaseName(phase)}阶段准备`);
  document.getElementById("continue").addEventListener("click", () => runPhase(phase, index));
}

async function runPhase(phase, phaseIndex) {
  let consecutiveFailures = 0;
  for (let length = MIN_SPAN; length <= MAX_SPAN; length += 1) {
    let failuresAtLevel = 0;
    for (let levelTrial = 1; levelTrial <= TRIALS_PER_LEVEL; levelTrial += 1) {
      const sequence = makeSequence(length);
      const row = await runTrial({ phase, sequence, levelTrial, practice: false });
      rows.push(row); completed += 1; LabTask.trial(row); LabTask.progress(completed, plannedTotal, Math.ceil((plannedTotal - completed) * 8));
      if (!row.correct) failuresAtLevel += 1;
      await LabTask.sleep(LabTask.debug ? 60 : 650);
    }
    consecutiveFailures = failuresAtLevel === TRIALS_PER_LEVEL ? failuresAtLevel : 0;
    if (consecutiveFailures >= TRIALS_PER_LEVEL) break;
  }
  if (phaseIndex === 0) return showPhaseIntro(1);
  finishTask();
}

async function runTrial({ phase, sequence, levelTrial, practice }) {
  LabTask.render(`<section class="test-panel" tabindex="-1"><div class="trial-header"><strong>${practice ? "练习" : `${phaseName(phase)} · ${sequence.length}个方块`}</strong><span>${practice ? phaseName(phase) : `本级第${levelTrial}/${TRIALS_PER_LEVEL}题`}</span></div><div class="stimulus-zone">${boardHtml(false)}<div class="sr-only" aria-live="assertive">请看方块</div></div><div class="trial-footer"><div class="corsi-status watch">请看方块亮起</div></div></section>`, practice ? "练习" : `${phaseName(phase)}测试`);
  const panel = document.querySelector(".test-panel"); panel.focus();
  await LabTask.sleep(LabTask.debug ? 80 : 700);
  for (const blockIndex of sequence) {
    const block = document.querySelector(`[data-block="${blockIndex}"]`);
    block.classList.add("flash");
    await LabTask.sleep(FLASH_MS);
    block.classList.remove("flash");
    await LabTask.sleep(GAP_MS);
  }
  document.querySelector(".stimulus-zone").innerHTML = boardHtml(true);
  const status = document.querySelector(".corsi-status"); status.className = "corsi-status respond"; status.textContent = phase === "forward" ? "请按顺序点击" : "请按倒序点击";
  const expected = phase === "forward" ? [...sequence] : [...sequence].reverse();
  const responses = [];
  const startedAt = performance.now();
  let firstTapAt = null;
  return new Promise((resolve) => {
    const buttons = Array.from(document.querySelectorAll("button.corsi-block"));
    buttons.forEach((button) => button.addEventListener("click", async () => {
      if (firstTapAt === null) firstTapAt = performance.now();
      const value = Number(button.dataset.block);
      responses.push(value); button.classList.add("chosen"); button.disabled = true;
      if (responses.length < expected.length) return;
      buttons.forEach((item) => { item.disabled = true; });
      const correct = Number(expected.every((item, index) => item === responses[index]));
      if (practice) {
        status.className = `corsi-status ${correct ? "respond" : "watch"}`;
        status.textContent = correct ? "正确" : "记住亮起的先后顺序";
        await LabTask.sleep(LabTask.debug ? 60 : 500);
      }
      resolve({
        task_version: VERSION, phase, phase_order: phaseOrder.join("-then-"), practice: Number(practice), sequence_length: sequence.length, level_trial: levelTrial,
        presented_sequence: sequence.map((item) => item + 1).join("-"), expected_sequence: expected.map((item) => item + 1).join("-"), response_sequence: responses.map((item) => item + 1).join("-"),
        correct, first_tap_latency_ms: LabTask.round(firstTapAt - startedAt), response_duration_ms: LabTask.round(performance.now() - startedAt),
        presentation_interval_ms: FLASH_MS + GAP_MS, trial_finished_at: new Date().toISOString(),
      });
    }));
  });
}

function phaseSummary(phase) {
  const testRows = rows.filter((row) => !row.practice && row.phase === phase);
  const correct = testRows.filter((row) => row.correct === 1);
  const span = correct.length ? Math.max(...correct.map((row) => row.sequence_length)) : 0;
  return { span, correctCount: correct.length, product: span * correct.length, firstTap: LabTask.median(correct.map((row) => row.first_tap_latency_ms)) };
}

function finishTask() {
  LabTask.progress(plannedTotal, plannedTotal, 0);
  const forward = phaseSummary("forward"); const backward = phaseSummary("backward");
  const testRows = rows.filter((row) => !row.practice);
  const summary = {
    task_version: VERSION, completion_status: "complete", phase_order: phaseOrder.join("-then-"),
    forward_span: forward.span, forward_total_correct: forward.correctCount, forward_product_score: forward.product, forward_median_first_tap_ms: LabTask.round(forward.firstTap),
    backward_span: backward.span, backward_total_correct: backward.correctCount, backward_product_score: backward.product, backward_median_first_tap_ms: LabTask.round(backward.firstTap),
    combined_total_correct: forward.correctCount + backward.correctCount, combined_product_score: forward.product + backward.product,
    overall_accuracy: LabTask.round(LabTask.mean(testRows.map((row) => row.correct)), 4), median_response_time_ms: LabTask.round(LabTask.median(testRows.map((row) => row.response_duration_ms))),
    completed_formal_trials: testRows.length, stop_rule: "two failures at the same span level", debug_mode: Number(LabTask.debug), finished_at: new Date().toISOString(),
  };
  LabTask.childCompletion(); setTimeout(() => LabTask.complete(summary), 250);
}

LabTask.onInit((_data) => {
  rng = LabTask.mulberry32(LabTask.seedFor(VERSION));
  LabTask.progress(0, plannedTotal, Math.ceil(plannedTotal * 8)); showInstructions();
});
