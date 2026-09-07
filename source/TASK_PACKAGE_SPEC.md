# 任务ZIP接入规范（V1）

每个任务ZIP至少包含 `manifest.json` 和 `index.html`。平台会把任务放入受限 iframe 中运行；任务必须通过 `window.parent.postMessage()` 主动提交数据。

## manifest.json

```json
{
  "id": "flanker",
  "name": "儿童版 Flanker",
  "version": "1.0.0",
  "durationMinutes": 6,
  "domain": "抑制控制",
  "description": "一致与不一致条件的正确率和反应时",
  "entry": "index.html",
  "outputFields": ["condition", "correct", "rt_ms"]
}
```

- `id` 建议使用 `flanker`、`dccs`、`mot`、`corsi` 或 `tol`，这样导入后会替换任务库中相应的“待接入”卡片。
- `version` 每次修改正式实验逻辑后都应更新。
- `durationMinutes` 使用整数或小数，单位为分钟。

## 任务消息

任务加载完毕：

```js
window.parent.postMessage({ type: "TASK_READY" }, "*");
```

平台收到后会回传匿名登记信息：

```js
window.addEventListener("message", (event) => {
  if (event.data?.type !== "TASK_INIT") return;
  const participant = event.data.payload;
});
```

每完成一个试次：

```js
window.parent.postMessage({
  type: "TRIAL_DATA",
  trial: { block: "test", condition: "incongruent", correct: 1, rt_ms: 684 }
}, "*");
```

可选的进度消息：

```js
window.parent.postMessage({
  type: "TASK_PROGRESS",
  completed: 18,
  total: 48,
  remaining: 30,
  estimatedSeconds: 240
}, "*");
```

任务结束：

```js
window.parent.postMessage({
  type: "TASK_COMPLETE",
  summary: { accuracy: 0.92, mean_rt_ms: 731 }
}, "*");
```

平台会逐试次保存 `TRIAL_DATA`，并在 `TASK_COMPLETE` 后写入完成时间和汇总字段。字段名称应与任务变量字典保持一致。
