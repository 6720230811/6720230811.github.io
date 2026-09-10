import { diffLines, statOf, type DiffLine } from './diff';

/**
 * 「与仓库版本对比」浮层。
 *
 * 改了很多之后，只有「重新载入」这把一键抹掉的重锤，谁都不敢按下去。
 * 这里把仓库里的那份和编辑器里的这份摆在一起（统一视图，带行号），
 * 未改动的段落默认折起来，只有真的需要才展开。
 */

const CONTEXT = 2;

let dialog: HTMLDialogElement | null = null;

function ensureDialog(): HTMLDialogElement {
  if (dialog) return dialog;
  const el = document.createElement('dialog');
  el.className = 'diff';
  el.innerHTML = `
    <div class="diff__head">
      <b class="diff__title"></b>
      <span class="diff__stat"></span>
      <label class="diff__only"><input type="checkbox" checked /> 只看改动</label>
      <button class="diff__close" type="button" aria-label="关闭">×</button>
    </div>
    <div class="diff__body"></div>
  `;
  document.body.append(el);
  el.querySelector('.diff__close')?.addEventListener('click', () => el.close());
  dialog = el;
  return el;
}

/** 折叠未改动的段落：只留改动点前后各 CONTEXT 行 */
function fold(rows: DiffLine[]): { rows: DiffLine[]; collapsed: number }[] {
  const blocks: { rows: DiffLine[]; collapsed: number }[] = [];
  let cursor = 0;
  while (cursor < rows.length) {
    if (rows[cursor].kind !== 'same') {
      blocks.push({ rows: [rows[cursor]], collapsed: 0 });
      cursor += 1;
      continue;
    }
    let end = cursor;
    while (end < rows.length && rows[end].kind === 'same') end += 1;
    const run = rows.slice(cursor, end);
    if (run.length <= CONTEXT * 2 + 1) {
      blocks.push({ rows: run, collapsed: 0 });
    } else {
      blocks.push({ rows: run.slice(0, CONTEXT), collapsed: 0 });
      blocks.push({ rows: [], collapsed: run.length - CONTEXT * 2 });
      blocks.push({ rows: run.slice(-CONTEXT), collapsed: 0 });
    }
    cursor = end;
  }
  return blocks;
}

function lineRow(row: DiffLine): HTMLElement {
  const el = document.createElement('div');
  el.className = `diff__row diff__row--${row.kind}`;
  const oldNo = document.createElement('span');
  oldNo.className = 'diff__no';
  oldNo.textContent = row.oldNo === null ? '' : String(row.oldNo);
  const newNo = document.createElement('span');
  newNo.className = 'diff__no';
  newNo.textContent = row.newNo === null ? '' : String(row.newNo);
  const sign = document.createElement('span');
  sign.className = 'diff__sign';
  sign.textContent = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' ';
  const text = document.createElement('span');
  text.className = 'diff__text';
  text.textContent = row.text || ' ';
  el.append(oldNo, newNo, sign, text);
  return el;
}

export interface DiffOptions {
  title: string;
  /** 左侧（仓库里那份）的说明，如「仓库 · 3 分钟前」 */
  oldLabel: string;
  /** 右侧（编辑器里这份）的说明 */
  newLabel: string;
  oldText: string;
  newText: string;
}

export function openDiffDialog(opts: DiffOptions): void {
  const el = ensureDialog();
  const rows = diffLines(opts.oldText, opts.newText);
  const stat = statOf(rows);

  (el.querySelector('.diff__title') as HTMLElement).textContent = opts.title;
  (el.querySelector('.diff__stat') as HTMLElement).textContent = stat.changed
    ? `${opts.oldLabel} → ${opts.newLabel}：+${stat.added} / −${stat.removed} 行`
    : '两边完全一致';

  const body = el.querySelector('.diff__body') as HTMLElement;
  const only = el.querySelector<HTMLInputElement>('.diff__only input');
  const onlyWrap = el.querySelector<HTMLElement>('.diff__only');
  if (onlyWrap) onlyWrap.hidden = !stat.changed;

  function paint(): void {
    body.textContent = '';
    if (!rows.length) {
      body.textContent = '（内容为空）';
      return;
    }
    if (!stat.changed) {
      body.append(lineRow({ kind: 'same', text: '两边一致，没有需要对比的改动。', oldNo: null, newNo: null }));
      return;
    }

    if (only?.checked) {
      for (const block of fold(rows)) {
        if (block.collapsed) {
          const gap = document.createElement('div');
          gap.className = 'diff__gap';
          gap.textContent = `… ${block.collapsed} 行未改动 …`;
          body.append(gap);
        } else {
          for (const row of block.rows) body.append(lineRow(row));
        }
      }
      return;
    }
    for (const row of rows) body.append(lineRow(row));
  }

  only?.addEventListener('change', paint);
  paint();

  if (!el.open) el.showModal();
}
