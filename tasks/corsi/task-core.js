"use strict";

window.LabTask = (() => {
  const query = new URLSearchParams(location.search);
  const debug = query.get("debug") === "1";
  const app = document.getElementById("app");
  const phaseLabel = document.getElementById("phaseLabel");
  let initHandler = null;
  let initialized = false;
  let participant = null;

  function hashString(text) {
    let hash = 2166136261 >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
      value |= 0;
      value = (value + 0x6d2b79f5) | 0;
      let result = Math.imul(value ^ (value >>> 15), 1 | value);
      result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedFor(label, stableAcrossSession = false) {
    const identity = participant?.participantId || participant?.participant_id || "anonymous";
    const session = stableAcrossSession ? "stable" : (participant?.session || "pre");
    return hashString(`${identity}|${session}|${label}`);
  }

  function shuffle(items, rng = Math.random) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = Math.floor(rng() * (index + 1));
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  }

  function render(html, phase = "") {
    app.innerHTML = html;
    if (phaseLabel) phaseLabel.textContent = phase;
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function mean(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  }

  function median(values) {
    const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!valid.length) return null;
    const middle = Math.floor(valid.length / 2);
    return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
  }

  function standardDeviation(values) {
    const valid = values.filter(Number.isFinite);
    if (valid.length < 2) return null;
    const average = mean(valid);
    return Math.sqrt(valid.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (valid.length - 1));
  }

  function round(value, digits = 1) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function progress(completed, total, estimatedSeconds = 0) {
    window.parent.postMessage({ type: "TASK_PROGRESS", completed, total, remaining: Math.max(0, total - completed), estimatedSeconds }, "*");
  }

  function trial(row) {
    window.parent.postMessage({ type: "TRIAL_DATA", trial: row }, "*");
  }

  function complete(summary, status = "complete") {
    window.parent.postMessage({ type: "TASK_COMPLETE", summary, status }, "*");
  }

  function childCompletion(title = "任务完成") {
    render(`<section class="completion-screen"><div class="completion-check" aria-hidden="true">✓</div><h1>${title}</h1><p>请告诉测试员：我已经完成了。</p></section>`, "已完成");
  }

  function onInit(handler) {
    initHandler = handler;
    if (participant && !initialized) {
      initialized = true;
      handler(participant);
    }
  }

  window.addEventListener("message", (event) => {
    if (!event.data || event.data.type !== "TASK_INIT" || initialized) return;
    participant = event.data.payload || {};
    if (initHandler) {
      initialized = true;
      initHandler(participant);
    }
  });

  window.parent.postMessage({ type: "TASK_READY" }, "*");

  return { debug, hashString, mulberry32, seedFor, shuffle, render, sleep, mean, median, standardDeviation, round, progress, trial, complete, childCompletion, onInit };
})();
