'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BrainCircuit, ArrowRight, Check, Clock3, LogOut } from 'lucide-react';
import {
  api,
  ApiError,
  encrypt,
  outbox,
  TASKS,
  type Student,
  type Run,
  type Pending,
} from '@/lib/lab-client';

const EMPTY = { studentId: '', age: 0, sex: '', grade: '' };
export default function Platform() {
  const [student, setStudent] = useState<Student | null>(null),
    [form, setForm] = useState<Student>(EMPTY);
  const [publicKey, setPublicKey] = useState<JsonWebKey | null>(null),
    [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [completed, setCompleted] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]),
    [online, setOnline] = useState(true);
  const submitting = useRef(false),
    memoryPending = useRef<Pending | null>(null);
  const [memoryWaiting, setMemoryWaiting] = useState(false);
  const studentId = student?.studentId;
  const refresh = useCallback(async () => {
    const all = await outbox.all();
    setPending(all);
    return all;
  }, []);
  const submit = useCallback(async () => {
    if (submitting.current || !studentId) return;
    submitting.current = true;
    try {
      const saved = await outbox.all().catch(() => [] as Pending[]);
      const all =
        memoryPending.current &&
        !saved.some((p) => p.id === memoryPending.current?.id)
          ? [...saved, memoryPending.current]
          : saved;
      for (const item of all.filter((p) => p.student === studentId)) {
        try {
          await api('complete', item.envelope);
          await outbox.remove(item.id).catch(() => {});
          if (memoryPending.current?.id === item.id) {
            memoryPending.current = null;
            setMemoryWaiting(false);
          }
          setNotice('数据已提交。');
        } catch (error) {
          setNotice(
            error instanceof Error
              ? error.message
              : '联网后将自动提交，请保持页面打开。',
          );
          if (error instanceof ApiError && error.status === 401)
            setStudent(null);
          break;
        }
      }
      await outbox
        .all()
        .then(setPending)
        .catch(() => {});
    } finally {
      submitting.current = false;
    }
  }, [studentId]);
  useEffect(() => {
    queueMicrotask(() => setOnline(navigator.onLine));
    const update = () => queueMicrotask(() => setOnline(navigator.onLine));
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    queueMicrotask(
      () =>
        void refresh().catch(() =>
          setNotice('浏览器暂存不可用，完成后请保持页面打开直到提交成功。'),
        ),
    );
    void api<{ participant: Student; publicKey: JsonWebKey }>('me')
      .then(async (result) => {
        const old = sessionStorage.getItem('lab-active-run');
        if (old) {
          const previous = JSON.parse(old) as Run;
          const queued = await outbox.all().catch(() => []);
          if (!queued.some((p) => p.id === previous.run))
            await api('abandon', {
              run: previous.run,
              secret: previous.secret,
            });
          sessionStorage.removeItem('lab-active-run');
        }
        setStudent(result.participant);
        setPublicKey(result.publicKey);
      })
      .catch(() => {});
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [refresh]);
  useEffect(() => {
    if (online) void submit();
    const timer = setInterval(() => void submit(), 15000);
    return () => clearInterval(timer);
  }, [online, submit]);
  async function register(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const result = await api<{ participant: Student; publicKey: JsonWebKey }>(
        'register',
        form,
      );
      const old = sessionStorage.getItem('lab-active-run');
      if (old) {
        const previous = JSON.parse(old) as Run;
        const queued = await outbox.all().catch(() => []);
        if (!queued.some((p) => p.id === previous.run))
          await api('abandon', { run: previous.run, secret: previous.secret });
        sessionStorage.removeItem('lab-active-run');
      }
      setStudent(result.participant);
      setPublicKey(result.publicKey);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function start(task: string) {
    setBusy(true);
    setNotice('');
    try {
      if (!crypto.subtle) throw new Error('请使用HTTPS安全地址打开网站。');
      if (
        pending.some(
          (p) => p.student === student?.studentId && p.task === task,
        ) ||
        memoryPending.current?.task === task
      )
        throw new Error('此项目有待提交数据，请先联网完成提交。');
      const next = await api<Run>('start', { task });
      sessionStorage.setItem('lab-active-run', JSON.stringify(next));
      setRun(next);
      setCompleted(false);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const finish = useCallback(
    async (current: Run, data: Record<string, unknown>) => {
      if (!publicKey)
        throw new Error('加密信息不可用，请保持页面打开并联系老师。');
      const envelope = await encrypt(publicKey, {
        run: current.run,
        secret: current.secret,
        task: current.task,
        data,
      });
      const item = {
        id: current.run,
        student: current.participant.studentId,
        task: current.task,
        envelope,
      };
      memoryPending.current = item;
      setMemoryWaiting(true);
      try {
        await outbox.put(item);
        await refresh();
      } catch {
        setNotice('暂存不可用，请不要关闭页面，联网后将自动提交。');
      }
      sessionStorage.removeItem('lab-active-run');
      setRun(null);
      setCompleted(true);
      void submit();
    },
    [publicKey, refresh, submit],
  );
  const exit = useCallback(async (current: Run) => {
    try {
      await api('abandon', { run: current.run, secret: current.secret });
      sessionStorage.removeItem('lab-active-run');
      setNotice('本次未完成，数据未保存。');
    } catch {
      setNotice('本次测试未保存。联网后重新进入，或请老师释放项目占用。');
    }
    setRun(null);
  }, []);
  if (run)
    return <Runner run={run} online={online} onFinish={finish} onExit={exit} />;
  const waiting = pending.filter(
    (p) => p.student === student?.studentId,
  ).length;
  return (
    <div className="lab-shell">
      <header className="lab-header">
        <Link href="/" className="lab-brand">
          <BrainCircuit />
          <strong>认知实验</strong>
        </Link>
        <span>学生测试端</span>
        {student && (
          <button
            disabled={busy || memoryWaiting}
            onClick={() => {
              setStudent(null);
              setForm(EMPTY);
              setCompleted(false);
              setNotice('');
            }}
          >
            <LogOut size={17} />
            更换学生
          </button>
        )}
      </header>
      <main className="lab-main">
        {notice && <output className="lab-notice">{notice}</output>}
        {!online && (
          <div className="lab-notice">
            当前网络已断开，恢复连接后可进入测试或提交数据。
          </div>
        )}
        {!student ? (
          <section className="entry-layout">
            <div className="entry-intro">
              <h1>
                准备好，
                <br />
                开始今天的测试。
              </h1>
              <p>请填写你的信息，确认无误后进入项目列表。</p>
              <p className="muted">三年级 · 四年级</p>
            </div>
            <form className="lab-form" onSubmit={register}>
              <h2>填写学生信息</h2>
              <label>
                学号
                <input
                  autoComplete="off"
                  maxLength={100}
                  required
                  value={form.studentId}
                  onChange={(e) =>
                    setForm({ ...form, studentId: e.target.value })
                  }
                />
              </label>
              <label>
                年龄（周岁）
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={120}
                  step={1}
                  required
                  value={form.age || ''}
                  onChange={(e) =>
                    setForm({ ...form, age: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                性别
                <select
                  required
                  value={form.sex}
                  onChange={(e) => setForm({ ...form, sex: e.target.value })}
                >
                  <option value="">请选择</option>
                  <option>男</option>
                  <option>女</option>
                </select>
              </label>
              <label>
                年级
                <select
                  required
                  value={form.grade}
                  onChange={(e) => setForm({ ...form, grade: e.target.value })}
                >
                  <option value="">请选择</option>
                  <option>三年级</option>
                  <option>四年级</option>
                </select>
              </label>
              <button className="lab-primary" disabled={busy || !online}>
                {busy ? '正在核对…' : '进入测试'}
                <ArrowRight size={18} />
              </button>
            </form>
          </section>
        ) : completed ? (
          <section className="lab-complete">
            <Check size={46} />
            <h1>测试已完成，感谢参与</h1>
            <p>
              {waiting || memoryWaiting
                ? '正在提交数据，请保持页面打开并等待网络恢复。'
                : '可以返回项目列表，选择下一个测试。'}
            </p>
            {!!waiting && (
              <button onClick={() => void submit()}>重试提交</button>
            )}
            <button className="lab-primary" onClick={() => setCompleted(false)}>
              返回项目列表
              <ArrowRight size={18} />
            </button>
          </section>
        ) : (
          <>
            <div className="lab-title">
              <h1>选择测试项目</h1>
              <p>
                学号 {student.studentId} · {student.grade} ·
                自由选择一个项目开始
              </p>
            </div>
            {waiting > 0 && (
              <div className="lab-notice">
                有 {waiting} 项完整测试等待提交。
                <button onClick={() => void submit()}>立即重试</button>
              </div>
            )}
            <div className="lab-task-list">
              {TASKS.map((task) => (
                <article key={task.id}>
                  <div>
                    <span className="task-domain">{task.domain}</span>
                    <h2>{task.name}</h2>
                  </div>
                  <span className="task-duration">
                    <Clock3 size={17} />约 {task.minutes} 分钟
                  </span>
                  <button
                    className="lab-primary"
                    disabled={busy || !online}
                    onClick={() => void start(task.id)}
                  >
                    开始测试
                    <ArrowRight size={18} />
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
      </main>
      <footer className="lab-footer">
        <span>认知实验任务平台</span>
        <Link href="/admin">管理员登录</Link>
      </footer>
    </div>
  );
}

function Runner({
  run,
  online,
  onFinish,
  onExit,
}: {
  run: Run;
  online: boolean;
  onFinish: (run: Run, data: Record<string, unknown>) => Promise<void>;
  onExit: (run: Run) => Promise<void>;
}) {
  const frame = useRef<HTMLIFrameElement>(null),
    rows = useRef<Record<string, unknown>[]>([]),
    finished = useRef(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 }),
    [error, setError] = useState(''),
    [finalData, setFinalData] = useState<Record<string, unknown> | null>(null);
  const task = TASKS.find((t) => t.id === run.task)!;
  const initialize = useCallback(
    () =>
      frame.current?.contentWindow?.postMessage(
        {
          type: 'TASK_INIT',
          payload: {
            participantId: run.participant.studentId,
            age: String(run.participant.age),
            sex: run.participant.sex,
            grade: run.participant.grade,
            session: 'pre',
            assessorId: '',
            deviceId: '',
          },
        },
        '*',
      ),
    [run],
  );
  const save = useCallback(
    async (data: Record<string, unknown>) => {
      setError('');
      try {
        await onFinish(run, data);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [onFinish, run],
  );
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        !event.data ||
        finished.current
      )
        return;
      const m = event.data;
      if (m.type === 'TASK_READY') initialize();
      if (m.type === 'TRIAL_DATA')
        rows.current.push(m.trial || m.payload || {});
      if (m.type === 'TASK_PROGRESS')
        setProgress({
          completed: Number(m.completed || 0),
          total: Number(m.total || 0),
        });
      if (m.type === 'TASK_COMPLETE') {
        finished.current = true;
        if (m.status && m.status !== 'complete') {
          setError('本次测试未完成，数据不保存。');
          void onExit(run);
          return;
        }
        const data = {
          status: 'complete',
          trials: rows.current,
          summary: m.summary || m.payload || {},
          participant: run.participant,
          finishedAt: new Date().toISOString(),
          device: {
            userAgent: navigator.userAgent,
            width: innerWidth,
            height: innerHeight,
            pixelRatio: devicePixelRatio,
          },
        };
        setFinalData(data);
        void save(data);
      }
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (!finished.current) {
        event.preventDefault();
        Reflect.set(event, 'returnValue', '');
      }
    };
    window.addEventListener('message', listener);
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('message', listener);
      window.removeEventListener('beforeunload', unload);
    };
  }, [initialize, onExit, run, save]);
  return (
    <div className="runner-shell">
      <header className="runner-bar">
        <div className="runner-task">
          <strong>{task.name}</strong>
          <small>学号 {run.participant.studentId}</small>
        </div>
        <div className="runner-progress">
          {progress.total
            ? `已完成 ${progress.completed}/${progress.total} 题`
            : '请按提示开始'}
          {!online && <span>网络断开，可以继续测试</span>}
        </div>
        <button
          className="exit-test"
          disabled={!!finalData}
          onClick={() => {
            if (confirm('退出后，本次未完成的数据不保存。确认退出？'))
              void onExit(run);
          }}
        >
          退出测试
        </button>
      </header>
      {error && (
        <div role="alert" className="lab-notice">
          {error}
          {finalData && (
            <button onClick={() => void save(finalData)}>重试保存</button>
          )}
        </div>
      )}
      {finalData ? (
        <section className="lab-complete">
          <h1>测试已完成，正在提交</h1>
          <p>请保持页面打开。</p>
        </section>
      ) : (
        <div className="task-stage">
          <iframe
            ref={frame}
            title={task.name}
            src={`/tasks/${run.task}/index.html`}
            onLoad={initialize}
            sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock"
          />
        </div>
      )}
    </div>
  );
}
