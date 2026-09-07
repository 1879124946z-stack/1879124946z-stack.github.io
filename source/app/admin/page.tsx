'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BrainCircuit,
  Download,
  RefreshCw,
  LogOut,
  ArrowLeft,
} from 'lucide-react';
import { api, apiFetch, ApiError, TASKS, type Student } from '@/lib/lab-client';
type Dashboard = {
  students: {
    id: string;
    age: number;
    sex: string;
    grade: string;
    created: string;
  }[];
  results: { student: string; task: string; finished: string }[];
  locks: { student: string; task: string; started: string }[];
};
export default function Admin() {
  const [data, setData] = useState<Dashboard | null>(null),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState('');
  const [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Student | null>(null),
    [preview, setPreview] = useState<{ title: string; csv: string } | null>(
      null,
    );
  const refresh = useCallback(async () => {
    try {
      setData(await api<Dashboard>('admin/dashboard'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setData(null);
        setPreview(null);
      } else setNotice((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);
  async function login(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      await api('admin/login', { username, password });
      setPassword('');
      await refresh();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mutate(path: string, body: unknown) {
    setBusy(true);
    setNotice('');
    try {
      await api(`admin/${path}`, body);
      await refresh();
      return true;
    } catch (e) {
      setNotice((e as Error).message);
      if (e instanceof ApiError && e.status === 401) {
        setData(null);
        setPreview(null);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function csv(task: string, kind: string) {
    const r = await apiFetch(`admin/export?task=${task}&kind=${kind}`, {
      cache: 'no-store',
    });
    if (!r.ok) {
      const e = (await r.json()) as { error: string };
      if (r.status === 401) {
        setData(null);
        setPreview(null);
      }
      throw new Error(e.error);
    }
    return await r.text();
  }
  function download(name: string, blob: Blob) {
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportOne(task: string, kind: string, view = false) {
    setBusy(true);
    setNotice('');
    try {
      const text = await csv(task, kind);
      if (view)
        setPreview({
          title: `${TASKS.find((t) => t.id === task)?.name} · ${kind === 'raw' ? '全部原始数据' : '汇总表'}`,
          csv: text,
        });
      else
        download(
          `${task}_${kind}.csv`,
          new Blob(['\ufeff', text.replace(/^\ufeff/, '')], {
            type: 'text/csv;charset=utf-8',
          }),
        );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportAll() {
    setBusy(true);
    setNotice('');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const task of TASKS)
        for (const kind of ['raw', 'summary']) {
          zip.file(
            `${task.id}/${task.id}_${kind}.csv`,
            '\ufeff' + (await csv(task.id, kind)).replace(/^\ufeff/, ''),
          );
        }
      download(
        '认知实验_按项目分别导出.zip',
        await zip.generateAsync({ type: 'blob' }),
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(studentId: string, task?: string, lockOnly = false) {
    const description = lockOnly
      ? '释放占用会使该次未提交测试无法提交；已保存数据保留'
      : task
        ? '删除该学生此项目的数据，并取消该项目正在进行的测试'
        : '删除该学生的登记信息和全部项目数据';
    if (confirm(`${description}。学号：${studentId}。确认操作？`))
      await mutate('delete', { studentId, task, lockOnly });
  }
  return (
    <div className="lab-shell">
      <header className="lab-header">
        <Link href="/" className="lab-brand">
          <BrainCircuit />
          <strong>认知实验</strong>
        </Link>
        <span>管理员后台</span>
        {data && (
          <button
            onClick={async () => {
              if (await mutate('logout', {})) {
                setData(null);
                setPreview(null);
              }
            }}
          >
            <LogOut size={17} />
            退出登录
          </button>
        )}
      </header>
      <main className="lab-main admin-main">
        {notice && (
          <div className="lab-notice" role="alert">
            {notice}
          </div>
        )}
        {loading ? (
          <output>正在载入…</output>
        ) : !data ? (
          <form className="lab-form admin-login" onSubmit={login}>
            <h1>管理员登录</h1>
            <p>登录后查看完成状态和实验数据。</p>
            <label>
              账号
              <input
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              密码
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="lab-primary" disabled={busy}>
              {busy ? '正在登录…' : '登录后台'}
            </button>
            <Link href="/">返回学生测试端</Link>
          </form>
        ) : (
          <>
            <div className="admin-title">
              <div>
                <h1>实验数据</h1>
                <p>
                  {data.students.length} 位学生已登记 · {data.results.length}{' '}
                  份完整项目记录
                </p>
              </div>
              <div className="admin-actions">
                <button disabled={busy} onClick={() => void refresh()}>
                  <RefreshCw size={17} />
                  刷新
                </button>
                <button
                  className="lab-primary"
                  disabled={busy}
                  onClick={() => void exportAll()}
                >
                  <Download size={17} />
                  {busy ? '正在处理…' : '批量下载 ZIP'}
                </button>
              </div>
            </div>
            <section className="admin-exports">
              <h2>按项目导出</h2>
              <p>
                各表按学号排序；不同项目始终分开。原始数据表包含每一道题，汇总表每位学生一行。
              </p>
              {TASKS.map((task) => (
                <div className="export-row" key={task.id}>
                  <strong>{task.name}</strong>
                  <button
                    disabled={busy}
                    onClick={() => void exportOne(task.id, 'raw', true)}
                  >
                    查看原始 CSV
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void exportOne(task.id, 'raw')}
                  >
                    下载原始数据
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void exportOne(task.id, 'summary')}
                  >
                    下载汇总表
                  </button>
                </div>
              ))}
            </section>
            {preview && (
              <section className="csv-preview">
                <header>
                  <h2>{preview.title}</h2>
                  <button onClick={() => setPreview(null)}>关闭预览</button>
                </header>
                <textarea
                  readOnly
                  aria-label={preview.title}
                  value={preview.csv}
                />
              </section>
            )}
            {editing && (
              <form
                className="lab-form edit-student"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await mutate('edit', editing)) setEditing(null);
                }}
              >
                <h2>修改学生信息 · {editing.studentId}</h2>
                <label>
                  年龄（周岁）
                  <input
                    required
                    type="number"
                    min={1}
                    max={120}
                    step={1}
                    value={editing.age}
                    onChange={(e) =>
                      setEditing({ ...editing, age: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  性别
                  <select
                    value={editing.sex}
                    onChange={(e) =>
                      setEditing({ ...editing, sex: e.target.value })
                    }
                  >
                    <option>男</option>
                    <option>女</option>
                  </select>
                </label>
                <label>
                  年级
                  <select
                    value={editing.grade}
                    onChange={(e) =>
                      setEditing({ ...editing, grade: e.target.value })
                    }
                  >
                    <option>三年级</option>
                    <option>四年级</option>
                  </select>
                </label>
                <div className="admin-actions">
                  <button className="lab-primary" disabled={busy}>
                    保存修改
                  </button>
                  <button type="button" onClick={() => setEditing(null)}>
                    取消
                  </button>
                </div>
              </form>
            )}
            <section className="student-ledger">
              <h2>学生完成状态</h2>
              <p>仅列出已登记学生。重新测试完成后才会替换旧数据。</p>
              {!data.students.length ? (
                <div className="lab-empty">
                  暂无学生登记。学生填写信息进入后，会显示在这里。
                </div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <caption className="sr-only">
                      各学生五项测试完成状态
                    </caption>
                    <thead>
                      <tr>
                        <th>学号</th>
                        <th>信息</th>
                        {TASKS.map((t) => (
                          <th key={t.id}>{t.name}</th>
                        ))}
                        <th>管理</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.students.map((p) => (
                        <tr key={p.id}>
                          <th scope="row">{p.id}</th>
                          <td>
                            {p.age} 岁 · {p.sex}
                            <br />
                            {p.grade}
                          </td>
                          {TASKS.map((t) => {
                            const result = data.results.find(
                                (r) => r.student === p.id && r.task === t.id,
                              ),
                              lock = data.locks.find(
                                (r) => r.student === p.id && r.task === t.id,
                              );
                            return (
                              <td key={t.id}>
                                <strong
                                  className={
                                    result ? 'state-complete' : 'state-empty'
                                  }
                                >
                                  {result ? '已完成' : '尚未完成'}
                                </strong>
                                {result && (
                                  <>
                                    <small>
                                      {new Date(result.finished).toLocaleString(
                                        'zh-CN',
                                      )}
                                    </small>
                                    <button
                                      className="text-danger"
                                      disabled={busy}
                                      onClick={() => void remove(p.id, t.id)}
                                    >
                                      删除数据
                                    </button>
                                  </>
                                )}
                                {lock && (
                                  <>
                                    <small>测试中 / 等待提交</small>
                                    <button
                                      disabled={busy}
                                      onClick={() =>
                                        void remove(p.id, t.id, true)
                                      }
                                    >
                                      释放占用
                                    </button>
                                  </>
                                )}
                              </td>
                            );
                          })}
                          <td>
                            <button
                              disabled={busy}
                              onClick={() =>
                                setEditing({
                                  studentId: p.id,
                                  age: p.age,
                                  sex: p.sex,
                                  grade: p.grade,
                                })
                              }
                            >
                              修改信息
                            </button>
                            <button
                              className="text-danger"
                              disabled={busy}
                              onClick={() => void remove(p.id)}
                            >
                              删除学生
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
      <footer className="lab-footer">
        <Link href="/">
          <ArrowLeft size={16} />
          学生测试端
        </Link>
        <span>每个项目仅保留最近一次完整数据</span>
      </footer>
    </div>
  );
}
