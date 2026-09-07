import type { ExperimentRecord } from './models';

function csvCell(value: unknown) {
  const text = value === null || value === undefined
    ? ''
    : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function download(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const content = [headers.join(','), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([`\ufeff${content}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const common = (record: ExperimentRecord) => ({
  participant_id: record.participant.participantId,
  session: record.participant.session,
  age: record.participant.age,
  sex: record.participant.sex,
  assessor_id: record.participant.assessorId,
  device_id: record.participant.deviceId,
  task_id: record.taskId,
  task_name: record.taskName,
  task_version: record.taskVersion,
  started_at: record.startedAt,
  finished_at: record.finishedAt ?? '',
  completion_status: record.status,
});

export function exportTrialCsv(records: ExperimentRecord[]) {
  const rows = records.flatMap((record) => record.trials.map((trial, index) => ({ ...common(record), trial_index: index + 1, ...trial })));
  download(`逐试次数据_${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

export function exportSummaryCsv(records: ExperimentRecord[]) {
  download(`任务汇总_${new Date().toISOString().slice(0, 10)}.csv`, records.map((record) => ({ ...common(record), ...record.summary })));
}
