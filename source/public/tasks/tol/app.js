"use strict";

const VERSION = "climb-tol-1.0.0";
const FORMAL_TRIALS = LabTask.debug ? 4 : 12;
const DIFFICULTIES = LabTask.debug ? [2, 3, 4, 5] : [2, 3, 4, 5];
const MAX_MOVES = 20;
const TIME_LIMIT_MS = LabTask.debug ? 12000 : 120000;
const COLOR_NAMES = { red: "红", blue: "蓝", yellow: "黄" };
const rows = [];
const formalRows = [];
let completed = 0;
const plannedTotal = 2 + FORMAL_TRIALS;
let formId = "A";
let formalProblems = [];

function chooseProblems(form) {
  const states = TolEngine.allStates();
  const candidates = [];
  states.forEach((start) => {
    const distances = TolEngine.distancesFrom(start);
    states.forEach((goal) => {
    const minimum = distances.get(TolEngine.key(goal));
    if (DIFFICULTIES.includes(minimum)) candidates.push({ start, goal, minimum });
    });
  });
  const formRng = LabTask.mulberry32(LabTask.seedFor(`${VERSION}|form-${form}`, true));
  const shuffled = LabTask.shuffle(candidates, formRng);
  const perDifficulty = Math.ceil(FORMAL_TRIALS / DIFFICULTIES.length);
  const selected = [];
  DIFFICULTIES.forEach((difficulty) => {
    const usedStarts = new Set(selected.map((item) => TolEngine.key(item.start)));
    const pool = shuffled.filter((item) => item.minimum === difficulty && !usedStarts.has(TolEngine.key(item.start)));
    selected.push(...pool.slice(0, perDifficulty));
  });
  return LabTask.shuffle(selected.slice(0, FORMAL_TRIALS), formRng);
}

function towerHtml(state, interactive = false, selectedPeg = null, compact = false) {
  return `<div class="tower-board ${interactive ? "current" : "goal"} ${compact ? "mini-board" : ""}">${state.map((peg, pegIndex) => `<${interactive ? "button" : "div"} class="tower-peg ${selectedPeg === pegIndex ? "selected" : ""}" ${interactive ? `type="button" data-peg="${pegIndex}" aria-label="柱${pegIndex + 1}，容量${TolEngine.CAPACITIES[pegIndex]}，当前${peg.length}个球"` : ""}><span class="peg-post"></span><span class="peg-base"></span>${peg.map((ball, level) => `<span class="tol-ball ${ball}" style="bottom:${compact ? 22 + level * 24 : 29 + level * 34}px" aria-label="${COLOR_NAMES[ball]}球"></span>`).join("")}<span class="peg-capacity">最多${TolEngine.CAPACITIES[pegIndex]}个</span></${interactive ? "button" : "div"}>`).join("")}</div>`;
}

function showInstructions() {
  const sampleStart = [["red", "blue", "yellow"], [], []];
  const sampleGoal = [["red", "blue"], ["yellow"], []];
  LabTask.render(`<section class="intro-card"><h1>用尽量少的步数搭好彩球</h1><p>把“现在”移动成“目标”。每次只能移动一根柱子最上面的球，柱子分别最多放3、2、1个球。</p><div class="tol-example"><div>${towerHtml(sampleStart, false, null, true)}<strong>现在</strong></div><span>→</span><div>${towerHtml(sampleGoal, false, null, true)}<strong>目标</strong></div></div><ul class="instruction-list"><li><span>1</span>先在心里想好，再开始移动。</li><li><span>2</span>先点球所在的柱子，再点要放到的柱子。</li><li><span>3</span>请尽量用题目提示的最少步数完成。</li></ul><div class="button-row"><button id="begin" class="primary-button">开始练习</button><span class="quiet-note">练习2题，正式测试12题</span></div></section>`, "任务说明");
  document.getElementById("begin").addEventListener("click", runPractice);
}

function findProblem(distance, offset = 0) {
  const states = TolEngine.allStates();
  const candidates = [];
  states.forEach((start) => {
    const distances = TolEngine.distancesFrom(start);
    states.forEach((goal) => { if (distances.get(TolEngine.key(goal)) === distance) candidates.push({ start, goal, minimum: distance }); });
  });
  return candidates[(LabTask.seedFor(`${VERSION}|practice-${distance}`, true) + offset) % candidates.length];
}

async function runPractice() {
  for (const distance of [1, 2]) {
    const row = await runTrial(findProblem(distance), true, distance, 2);
    rows.push(row); completed += 1; LabTask.trial(row); LabTask.progress(completed, plannedTotal, Math.ceil((plannedTotal - completed) * 45));
    await LabTask.sleep(LabTask.debug ? 80 : 650);
  }
  LabTask.render(`<section class="break-card"><h2>练习完成</h2><p>正式测试不提示对错。请先想好完整步骤，再开始移动。</p><button id="continue" class="primary-button">开始正式测试</button></section>`, "准备正式测试");
  document.getElementById("continue").addEventListener("click", runFormal);
}

async function runFormal() {
  for (let index = 0; index < formalProblems.length; index += 1) {
    const row = await runTrial(formalProblems[index], false, index + 1, formalProblems.length);
    rows.push(row); formalRows.push(row); completed += 1; LabTask.trial(row); LabTask.progress(completed, plannedTotal, Math.ceil((plannedTotal - completed) * 45));
    if (index === Math.floor(formalProblems.length / 2) - 1) await showBreak();
    else await LabTask.sleep(LabTask.debug ? 70 : 550);
  }
  finishTask();
}

function showBreak() {
  return new Promise((resolve) => {
    LabTask.render(`<section class="break-card"><h2>休息一下</h2><p>活动一下手指，准备好后继续第2组。</p><button id="continue" class="primary-button">继续第2组</button></section>`, "组间休息");
    document.getElementById("continue").addEventListener("click", resolve, { once: true });
  });
}

function runTrial(problem, practice, trialNumber, total) {
  return new Promise((resolve) => {
    let current = TolEngine.clone(problem.start);
    let selectedPeg = null;
    let moves = 0;
    const moveSequence = [];
    let violations = 0;
    let firstMoveAt = null;
    const startedAt = performance.now();
    let settled = false;

    function renderTrial(message = "先想好，再移动") {
      LabTask.render(`<section class="tol-panel"><div class="trial-header"><strong>${practice ? `练习 ${trialNumber}/${total}` : `正式测试 ${trialNumber}/${total}`}</strong><span>最少 ${problem.minimum} 步</span></div><div class="tol-workspace"><div class="tower-section"><h2>目标</h2>${towerHtml(problem.goal)}</div><div class="tower-section"><h2>现在</h2>${towerHtml(current, true, selectedPeg)}</div></div><div class="tol-controls"><div class="tol-status">已移动 <strong>${moves}</strong> 次 · 最少 <strong>${problem.minimum}</strong> 步</div><div class="tol-message" aria-live="polite">${message}</div><button id="clearSelection" class="secondary-button" ${selectedPeg === null ? "disabled" : ""}>取消选择</button></div></section>`, practice ? "练习" : "正式测试");
      document.querySelectorAll("button.tower-peg").forEach((peg) => peg.addEventListener("click", () => handlePeg(Number(peg.dataset.peg))));
      document.getElementById("clearSelection").addEventListener("click", () => { selectedPeg = null; renderTrial("已取消选择"); });
    }

    async function endTrial(solved, stopReason) {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      const endedAt = performance.now();
      const planningTime = firstMoveAt === null ? endedAt - startedAt : firstMoveAt - startedAt;
      const executionTime = firstMoveAt === null ? 0 : endedAt - firstMoveAt;
      if (practice) {
        const phrase = solved ? "完成了" : "练习结束，请记住柱子的容量";
        LabTask.render(`<section class="break-card"><h2>${phrase}</h2><p>${solved ? `你用了 ${moves} 步。下一题继续先想后做。` : "每次只能移动最上面的球。"}</p></section>`, "练习反馈");
        await LabTask.sleep(LabTask.debug ? 100 : 800);
      }
      resolve({
        task_version: VERSION, form_id: formId, block: practice ? "practice" : (trialNumber <= FORMAL_TRIALS / 2 ? "formal_1" : "formal_2"), block_trial: practice ? trialNumber : ((trialNumber - 1) % (FORMAL_TRIALS / 2)) + 1,
        practice: Number(practice), minimum_moves: problem.minimum, moves_made: moves, solved: Number(solved), perfect_solution: Number(solved && moves === problem.minimum), excess_moves: solved ? moves - problem.minimum : "",
        planning_time_ms: LabTask.round(planningTime), execution_time_ms: LabTask.round(executionTime), total_time_ms: LabTask.round(endedAt - startedAt), rule_violations: violations,
        start_state: TolEngine.key(problem.start), goal_state: TolEngine.key(problem.goal), final_state: TolEngine.key(current), move_sequence: moveSequence.join(";"), stop_reason: stopReason, max_moves: MAX_MOVES, time_limit_ms: TIME_LIMIT_MS, trial_finished_at: new Date().toISOString(),
      });
    }

    function handlePeg(pegIndex) {
      if (settled) return;
      if (selectedPeg === null) {
        if (!current[pegIndex].length) { violations += 1; renderTrial("这根柱子上没有球"); return; }
        selectedPeg = pegIndex; renderTrial("请选择要放到的柱子"); return;
      }
      if (selectedPeg === pegIndex) { selectedPeg = null; renderTrial("已取消选择"); return; }
      const next = TolEngine.move(current, selectedPeg, pegIndex);
      if (!next) { violations += 1; selectedPeg = null; renderTrial("这根柱子已经放满了"); return; }
      if (firstMoveAt === null) firstMoveAt = performance.now();
      moveSequence.push(`${selectedPeg + 1}>${pegIndex + 1}`);
      current = next; moves += 1; selectedPeg = null;
      if (TolEngine.key(current) === TolEngine.key(problem.goal)) { void endTrial(true, "solved"); return; }
      if (moves >= MAX_MOVES) { void endTrial(false, "max_moves"); return; }
      renderTrial("继续完成目标");
    }

    renderTrial();
    const timeout = setTimeout(() => void endTrial(false, "time_limit"), TIME_LIMIT_MS);
  });
}

function difficultySummary(difficulty) {
  const subset = formalRows.filter((row) => row.minimum_moves === difficulty);
  return { perfect: LabTask.mean(subset.map((row) => row.perfect_solution)), solved: LabTask.mean(subset.map((row) => row.solved)) };
}

function finishTask() {
  LabTask.progress(plannedTotal, plannedTotal, 0);
  const solved = formalRows.filter((row) => row.solved === 1);
  const summary = {
    task_version: VERSION, completion_status: "complete", form_id: formId, completed_formal_trials: formalRows.length,
    solved_rate: LabTask.round(LabTask.mean(formalRows.map((row) => row.solved)), 4), perfect_solution_rate: LabTask.round(LabTask.mean(formalRows.map((row) => row.perfect_solution)), 4),
    mean_excess_moves_solved: LabTask.round(LabTask.mean(solved.map((row) => Number(row.excess_moves))), 2), median_planning_time_ms: LabTask.round(LabTask.median(formalRows.map((row) => row.planning_time_ms))), median_execution_time_ms: LabTask.round(LabTask.median(formalRows.map((row) => row.execution_time_ms))),
    total_rule_violations: formalRows.reduce((sum, row) => sum + row.rule_violations, 0), timeout_count: formalRows.filter((row) => row.stop_reason === "time_limit").length,
    difficulty_2_perfect_rate: LabTask.round(difficultySummary(2).perfect, 4), difficulty_3_perfect_rate: LabTask.round(difficultySummary(3).perfect, 4), difficulty_4_perfect_rate: LabTask.round(difficultySummary(4).perfect, 4), difficulty_5_perfect_rate: LabTask.round(difficultySummary(5).perfect, 4),
    max_moves: MAX_MOVES, time_limit_ms: TIME_LIMIT_MS, debug_mode: Number(LabTask.debug), finished_at: new Date().toISOString(),
  };
  LabTask.childCompletion(); setTimeout(() => LabTask.complete(summary), 250);
}

LabTask.onInit((data) => {
  const formSeed = LabTask.seedFor(`${VERSION}|form`, true);
  formId = data.session === "post" ? (formSeed % 2 === 0 ? "B" : "A") : (formSeed % 2 === 0 ? "A" : "B");
  LabTask.progress(0, plannedTotal, Math.ceil(plannedTotal * 45)); showInstructions();
  setTimeout(() => { formalProblems = chooseProblems(formId); }, 0);
});
