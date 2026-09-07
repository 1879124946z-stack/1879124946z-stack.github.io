import { DatabaseSync } from 'node:sqlite';
import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { TASKS } from './catalog.mjs';

export const token = () => randomBytes(32).toString('base64url');
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export class Failure extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new Failure(status, message);
};
const jsonObject = (value) =>
  value && typeof value === 'object' && !Array.isArray(value);
export function profile(input) {
  const studentId =
    typeof input.studentId === 'string' ? input.studentId.trim() : '';
  if (
    !studentId ||
    studentId.length > 100 ||
    [...studentId].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    fail(400, '请填写有效学号（最多100个字符）。');
  if (!Number.isInteger(input.age) || input.age < 1 || input.age > 120)
    fail(400, '年龄请填写1至120之间的整数周岁。');
  if (
    !['男', '女'].includes(input.sex) ||
    !['三年级', '四年级'].includes(input.grade)
  )
    fail(400, '请选择性别和年级。');
  return { studentId, age: input.age, sex: input.sex, grade: input.grade };
}
export class Store {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY, age INTEGER NOT NULL, sex TEXT NOT NULL, grade TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, role TEXT NOT NULL, student TEXT REFERENCES students(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS locks(student TEXT REFERENCES students(id) ON DELETE CASCADE, task TEXT NOT NULL, run TEXT UNIQUE NOT NULL, secret TEXT NOT NULL, started TEXT NOT NULL, PRIMARY KEY(student, task));
      CREATE TABLE IF NOT EXISTS results(student TEXT REFERENCES students(id) ON DELETE CASCADE, task TEXT NOT NULL, run TEXT UNIQUE NOT NULL, started TEXT NOT NULL, finished TEXT NOT NULL, received TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(student, task));
      CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, salt TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_results_task ON results(task);
      CREATE INDEX IF NOT EXISTS idx_sessions_student ON sessions(student);`);
  }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  setAdmin(username, password) {
    if (!username.trim() || password.length < 12)
      fail(400, '管理员密码至少12个字符。');
    const salt = token(),
      digest = scryptSync(password, salt, 64).toString('hex');
    this.transaction(() => {
      this.db
        .prepare('INSERT OR REPLACE INTO admin VALUES(1,?,?,?)')
        .run(username.trim(), salt, digest);
      this.db.prepare("DELETE FROM sessions WHERE role='admin'").run();
    });
  }
  session(role, student = null) {
    const value = token();
    this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    this.db
      .prepare('INSERT INTO sessions VALUES(?,?,?,?)')
      .run(
        hash(value),
        role,
        student,
        Date.now() + (role === 'admin' ? 8 * 3600e3 : 30 * 86400e3),
      );
    return value;
  }
  authenticate(value, role) {
    const session = this.db
      .prepare('SELECT * FROM sessions WHERE hash=? AND expires>? AND role=?')
      .get(hash(value || ''), Date.now(), role);
    if (!session)
      fail(
        401,
        role === 'admin' ? '请登录管理员后台。' : '请重新填写学生信息后提交。',
      );
    return session;
  }
  limit(key, maximum, milliseconds) {
    const now = Date.now();
    this.db.prepare('DELETE FROM attempts WHERE reset<?').run(now);
    const current = this.db
      .prepare('SELECT * FROM attempts WHERE key=?')
      .get(key);
    if (current?.count >= maximum) fail(429, '操作过于频繁，请稍后再试。');
    this.db
      .prepare(
        'INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',
      )
      .run(key, now + milliseconds);
  }
  login(username, password, ip) {
    this.limit(`login:${ip}`, 12, 15 * 60e3);
    const admin = this.db.prepare('SELECT * FROM admin WHERE id=1').get();
    if (!admin) fail(503, '尚未配置管理员，请在服务器上完成初始化。');
    const actual = scryptSync(String(password || ''), admin.salt, 64);
    if (
      username !== admin.username ||
      !timingSafeEqual(actual, Buffer.from(admin.digest, 'hex'))
    )
      fail(401, '账号或密码错误。');
    return this.session('admin');
  }
  register(input) {
    const p = profile(input);
    this.transaction(() => {
      const old = this.db
        .prepare('SELECT * FROM students WHERE id=?')
        .get(p.studentId);
      if (
        old &&
        (old.age !== p.age || old.sex !== p.sex || old.grade !== p.grade)
      )
        fail(409, '信息与该学号已有记录不一致，请联系老师修改。');
      if (!old)
        this.db
          .prepare('INSERT INTO students VALUES(?,?,?,?,?)')
          .run(p.studentId, p.age, p.sex, p.grade, new Date().toISOString());
    });
    return { participant: p, session: this.session('student', p.studentId) };
  }
  student(id) {
    const p = this.db.prepare('SELECT * FROM students WHERE id=?').get(id);
    if (!p) fail(401, '学生记录已删除，请重新登记。');
    return { studentId: p.id, age: p.age, sex: p.sex, grade: p.grade };
  }
  start(student, task) {
    if (!TASKS.some((t) => t.id === task)) fail(400, '测试项目不存在。');
    return this.transaction(() => {
      if (
        this.db
          .prepare('SELECT run FROM locks WHERE student=? AND task=?')
          .get(student, task)
      )
        fail(
          409,
          '该学号正在其他页面进行此项目，请先退出原测试；若页面已关闭，请联系老师释放占用。',
        );
      const run = token(),
        secret = token(),
        started = new Date().toISOString();
      this.db
        .prepare('INSERT INTO locks VALUES(?,?,?,?,?)')
        .run(student, task, run, hash(secret), started);
      return { run, secret, started, task, participant: this.student(student) };
    });
  }
  abandon(student, run, secret) {
    this.db
      .prepare('DELETE FROM locks WHERE student=? AND run=? AND secret=?')
      .run(student, run, hash(secret || ''));
    return { ok: true };
  }
  complete(student, input) {
    const { run, secret, task, data } = input;
    const definition = TASKS.find((t) => t.id === task);
    if (
      !definition ||
      !jsonObject(data) ||
      !jsonObject(data.summary) ||
      !Array.isArray(data.trials) ||
      !data.trials.length ||
      data.trials.length > 10000 ||
      data.trials.some((r) => !jsonObject(r))
    )
      fail(400, '测试数据格式不完整。');
    const status = data.summary.completion_status ?? data.summary.status;
    if (
      data.status !== 'complete' ||
      status !== 'complete' ||
      data.summary.task_version !== definition.version ||
      data.summary.debug_mode
    )
      fail(400, '仅保存正式完成的测试数据。');
    if (!Number.isFinite(Date.parse(data.finishedAt)))
      fail(400, '缺少测试完成时间。');
    return this.transaction(() => {
      const previous = this.db
        .prepare('SELECT run FROM results WHERE student=? AND task=?')
        .get(student, task);
      if (previous?.run === run) return { ok: true };
      const lock = this.db
        .prepare(
          'SELECT * FROM locks WHERE student=? AND task=? AND run=? AND secret=?',
        )
        .get(student, task, run, hash(secret || ''));
      if (!lock)
        fail(409, '本次测试占用已失效，无法提交；原有完整数据不受影响。');
      this.db
        .prepare(
          `INSERT INTO results VALUES(?,?,?,?,?,?,?) ON CONFLICT(student,task) DO UPDATE SET run=excluded.run, started=excluded.started, finished=excluded.finished, received=excluded.received, payload=excluded.payload`,
        )
        .run(
          student,
          task,
          run,
          lock.started,
          data.finishedAt,
          new Date().toISOString(),
          JSON.stringify(data),
        );
      this.db.prepare('DELETE FROM locks WHERE run=?').run(run);
      return { ok: true };
    });
  }
  dashboard() {
    const students = this.db
      .prepare('SELECT * FROM students')
      .all()
      .sort((a, b) => compareId(a.id, b.id));
    const results = this.db
      .prepare('SELECT student,task,finished,received FROM results')
      .all();
    const locks = this.db
      .prepare('SELECT student,task,started FROM locks')
      .all();
    return { students, results, locks, tasks: TASKS };
  }
  edit(id, input) {
    const p = profile(input);
    if (p.studentId !== id)
      fail(400, '学号不可直接修改；学号误填时请删除后重新登记。');
    if (
      !this.db
        .prepare('UPDATE students SET age=?,sex=?,grade=? WHERE id=?')
        .run(p.age, p.sex, p.grade, id).changes
    )
      fail(404, '学生不存在。');
    return { ok: true };
  }
  remove(student, task, lockOnly = false) {
    if (task && !TASKS.some((t) => t.id === task))
      fail(400, '测试项目不存在。');
    this.transaction(() => {
      if (!task)
        this.db.prepare('DELETE FROM students WHERE id=?').run(student);
      else {
        this.db
          .prepare('DELETE FROM locks WHERE student=? AND task=?')
          .run(student, task);
        if (!lockOnly)
          this.db
            .prepare('DELETE FROM results WHERE student=? AND task=?')
            .run(student, task);
      }
    });
    return { ok: true };
  }
  csv(task, kind) {
    if (!TASKS.some((t) => t.id === task) || !['raw', 'summary'].includes(kind))
      fail(400, '必须选择一个测试项目和导出类型。');
    const records = this.db
      .prepare(
        'SELECT results.*,students.age,students.sex,students.grade FROM results JOIN students ON students.id=results.student WHERE task=?',
      )
      .all(task)
      .sort((a, b) => compareId(a.student, b.student));
    const rows = records.flatMap((r) => {
      const payload = JSON.parse(r.payload);
      const metadata = {
        student_id: r.student,
        age: r.age,
        sex: r.sex,
        grade: r.grade,
        task_id: task,
        run_id: r.run,
        started_at: r.started,
        finished_at: r.finished,
        received_at: r.received,
        device: payload.device ?? {},
        participant_at_test: payload.participant ?? {},
      };
      const fields = (row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [`data.${key}`, value]),
        );
      return kind === 'summary'
        ? [{ ...metadata, ...fields(payload.summary) }]
        : payload.trials.map((row, index) => ({
            ...metadata,
            trial_index: index + 1,
            ...fields(row),
          }));
    });
    const columns = [
      ...new Set([
        'student_id',
        'age',
        'sex',
        'grade',
        'task_id',
        'started_at',
        'finished_at',
        'received_at',
        ...rows.flatMap(Object.keys),
      ]),
    ];
    return (
      '\ufeff' +
      [columns, ...rows.map((row) => columns.map((c) => row[c] ?? ''))]
        .map((row) => row.map(csvCell).join(','))
        .join('\r\n')
    );
  }
}
export function compareId(a, b) {
  return a.localeCompare(b, 'zh-CN', { numeric: true }) || a.localeCompare(b);
}
export function csvCell(value) {
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[\s]*[=+@-]/.test(text) && typeof value !== 'number') text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
