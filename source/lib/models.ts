export type SessionPhase = 'pre' | 'post';

export type Participant = {
  participantId: string;
  session: SessionPhase;
  age: string;
  sex: string;
  assessorId: string;
  deviceId: string;
};

export type TaskManifest = {
  id: string;
  name: string;
  version: string;
  durationMinutes: number;
  domain: string;
  description?: string;
  entry?: string;
  outputFields?: string[];
};

export type StoredTask = TaskManifest & {
  importedAt: string;
  html: string;
};

export type TrialRow = Record<string, unknown>;

export type ExperimentRecord = {
  id: string;
  taskId: string;
  taskName: string;
  taskVersion: string;
  participant: Participant;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'complete' | 'stopped';
  trials: TrialRow[];
  summary: Record<string, unknown>;
};

export type CatalogTask = TaskManifest & {
  abbreviation: string;
  accent: string;
  metric: string;
  builtinPath?: string;
  imported?: boolean;
};
