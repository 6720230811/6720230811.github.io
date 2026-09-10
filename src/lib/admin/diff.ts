/**
 * 行级 diff（够后台对比用）。
 *
 * 做法是最朴素的 LCS 动态规划：先剪掉公共前后缀（编辑通常集中在中间几行），
 * 剩下的部分再算。真遇到两边都特别长的情况就退化成「整块替换」——
 * 后台里没人等着看一篇 5000 行的逐行 diff，别为它把页面卡住。
 */

export type DiffKind = 'same' | 'add' | 'del';

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** 各自在老/新文本里的行号（从 1 开始），没有则为 null */
  oldNo: number | null;
  newNo: number | null;
}

/** DP 的规模上限：超过就退化成两块 */
const MAX_CELLS = 400 * 400;

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const before = oldText.split('\n');
  const after = newText.split('\n');

  // 剪公共前缀 / 后缀
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }

  const oldMid = before.slice(head, before.length - tail);
  const newMid = after.slice(head, after.length - tail);

  const out: DiffLine[] = [];
  for (let i = 0; i < head; i += 1) {
    out.push({ kind: 'same', text: before[i], oldNo: i + 1, newNo: i + 1 });
  }

  const pushMid = (rows: DiffLine[]) => {
    for (const row of rows) {
      out.push({
        ...row,
        oldNo: row.kind === 'add' ? null : head + (row.oldNo ?? 0),
        newNo: row.kind === 'del' ? null : head + (row.newNo ?? 0),
      });
    }
  };

  if (oldMid.length * newMid.length > MAX_CELLS) {
    pushMid(oldMid.map((text, i) => ({ kind: 'del' as const, text, oldNo: i + 1, newNo: null })));
    pushMid(newMid.map((text, i) => ({ kind: 'add' as const, text, oldNo: null, newNo: i + 1 })));
  } else {
    pushMid(lcsRows(oldMid, newMid));
  }

  for (let i = 0; i < tail; i += 1) {
    const oldIndex = before.length - tail + i;
    const newIndex = after.length - tail + i;
    out.push({ kind: 'same', text: before[oldIndex], oldNo: oldIndex + 1, newNo: newIndex + 1 });
  }

  return out;
}

/** 中间段落的 LCS：把两串行切成 same / del / add */
function lcsRows(oldMid: string[], newMid: string[]): DiffLine[] {
  const n = oldMid.length;
  const m = newMid.length;

  // table[i][j] = oldMid[i..] 与 newMid[j..] 的最长公共子序列长度
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] =
        oldMid[i] === newMid[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const rows: DiffLine[] = [];
  const pendingDel: DiffLine[] = [];
  const pendingAdd: DiffLine[] = [];
  const flush = () => {
    rows.push(...pendingDel, ...pendingAdd);
    pendingDel.length = 0;
    pendingAdd.length = 0;
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldMid[i] === newMid[j]) {
      flush();
      rows.push({ kind: 'same', text: oldMid[i], oldNo: i + 1, newNo: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      pendingDel.push({ kind: 'del', text: oldMid[i], oldNo: i + 1, newNo: null });
      i += 1;
    } else {
      pendingAdd.push({ kind: 'add', text: newMid[j], oldNo: null, newNo: j + 1 });
      j += 1;
    }
  }
  while (i < n) {
    pendingDel.push({ kind: 'del', text: oldMid[i], oldNo: i + 1, newNo: null });
    i += 1;
  }
  while (j < m) {
    pendingAdd.push({ kind: 'add', text: newMid[j], oldNo: null, newNo: j + 1 });
    j += 1;
  }
  flush();
  return rows;
}

export interface DiffStat {
  added: number;
  removed: number;
  /** 完全不相同的行数（判断「有没有改动」用） */
  changed: number;
}

export function statOf(rows: readonly DiffLine[]): DiffStat {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === 'add') added += 1;
    else if (row.kind === 'del') removed += 1;
  }
  return { added, removed, changed: added + removed };
}
