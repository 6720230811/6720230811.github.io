import { $, setStatus, confirmDialog } from './dom';
import { crawlConfigured, readCrawlConfig } from './crawl';
import { buildDraftFromPaste, buildDraftFromUrl, type ImportOptions } from './ingest';
import { isDirty } from './unsaved';
import { startDraftFromImport } from './post';

/**
 * 「从网址导入」浮层。
 *
 * 产品立场（写在最前面，免得以后自己改跑偏）：
 * - 生成的是**草稿**，永远不自动发布；导入的东西必须人看过
 * - 正文里带一张来源卡，frontmatter 记 `source`，文章页 canonical 指回原文
 * - 抓取服务只是"可选加速器"：没配置、挂了、被反爬，都能退到「手动粘贴正文」这条路，
 *   所以界面上两条路都摆在明面上，而不是等失败了才告诉用户
 */

let dialog: HTMLDialogElement | null = null;
let busy = false;

function ensureDialog(): HTMLDialogElement {
  if (dialog) return dialog;

  const el = document.createElement('dialog');
  el.className = 'import';
  el.innerHTML = `
    <div class="import__head">
      <b>从网址导入</b>
      <button class="import__close" type="button" aria-label="关闭">×</button>
    </div>
    <div class="import__body">
      <label class="field">
        <span class="field__label">文章地址</span>
        <span class="field__hint">抓取正文与元数据，生成一篇草稿（标题/摘要/标签自动填，分类留给你）</span>
        <input id="import-url" class="input" type="url" placeholder="https://…" spellcheck="false" />
      </label>

      <div class="import__opts">
        <label class="import__opt">
          <input type="checkbox" id="import-images" checked />
          <span>把正文图片转存到本站（避免防盗链，图片也跟着仓库走）</span>
        </label>
        <label class="import__opt">
          <input type="radio" name="import-style" value="full" checked />
          <span>保留全文（自动标注「原文」与出处）</span>
        </label>
        <label class="import__opt">
          <input type="radio" name="import-style" value="excerpt" />
          <span>只要开头几段，主体留给自己写</span>
        </label>
      </div>

      <details class="import__paste">
        <summary>抓不到？手动粘贴正文（不依赖抓取服务）</summary>
        <textarea id="import-paste" class="input input--code" rows="7" spellcheck="false"
          placeholder="在原文页面全选复制，粘到这里。HTML 富文本或 Markdown 都认。"></textarea>
      </details>

      <p class="import__service"></p>
      <p class="import__status" hidden></p>
      <p class="import__target"></p>
    </div>
    <div class="import__actions">
      <button class="btn btn--ghost" type="button" data-import-cancel>取消</button>
      <button class="btn btn--primary" type="button" data-import-go>生成草稿</button>
    </div>
  `;
  document.body.append(el);

  el.querySelector('.import__close')?.addEventListener('click', () => el.close());
  el.querySelector('[data-import-cancel]')?.addEventListener('click', () => el.close());
  el.querySelector('[data-import-go]')?.addEventListener('click', () => void run());

  dialog = el;
  return el;
}

function paintService(): void {
  const el = ensureDialog().querySelector('.import__service') as HTMLElement;
  if (crawlConfigured()) {
    el.textContent = `抓取服务：${readCrawlConfig().base}`;
    el.dataset.state = 'ok';
  } else {
    el.textContent = '还没配抓取服务（左下角状态胶囊 → 抓取服务），现在只能用「手动粘贴正文」。';
    el.dataset.state = 'warn';
  }

  const target = ensureDialog().querySelector('.import__target') as HTMLElement;
  const lang = $<HTMLSelectElement>('post-lang').value || 'zh';
  target.textContent = `将写入 src/content/posts/${lang}/，并标记为草稿。`;
}

function say(text: string, state: 'busy' | 'ok' | 'error'): void {
  const el = ensureDialog().querySelector('.import__status') as HTMLElement;
  el.hidden = false;
  el.textContent = text;
  el.dataset.state = state;
}

async function run(): Promise<void> {
  if (busy) return;
  const el = ensureDialog();
  const urlInput = el.querySelector('#import-url') as HTMLInputElement;
  const pasteInput = el.querySelector('#import-paste') as HTMLTextAreaElement;
  const transferImages = (el.querySelector('#import-images') as HTMLInputElement).checked;
  const style = (el.querySelector('input[name="import-style"]:checked') as HTMLInputElement).value as
    | 'full'
    | 'excerpt';

  const url = urlInput.value.trim();
  const pasted = pasteInput.value.trim();
  if (!url && !pasted) {
    say('至少填一个：文章地址，或者把正文粘到下面。', 'error');
    return;
  }

  // 导入会覆盖编辑器里的内容，有未保存改动先问一句
  if (isDirty()) {
    const ok = await confirmDialog({
      title: '当前改动还没发布',
      body: '导入会清空编辑器里现在的内容（本地自动暂存里还留着一份，但界面会被替换）。继续吗？',
      okLabel: '继续导入',
      danger: false,
    });
    if (!ok) return;
  }

  busy = true;
  const go = el.querySelector('[data-import-go]') as HTMLButtonElement;
  go.disabled = true;
  say(pasted && !url ? '正在清洗粘贴的正文…' : '正在抓取…（首次会拉起浏览器，可能要十几秒）', 'busy');

  try {
    const options: ImportOptions = { url, pasted, transferImages, style };
    const outcome = pasted
      ? await buildDraftFromPaste(pasted, options)
      : await buildDraftFromUrl(url, options);

    if (!outcome.ok || !outcome.draft) {
      say(outcome.error ?? '导入失败。', 'error');
      return;
    }

    await startDraftFromImport(outcome.draft);
    el.close();
    setStatus(
      `已生成草稿《${outcome.draft.frontmatter.title}》：${outcome.report.join('；')}。确认后发布。`,
      'ok'
    );
  } finally {
    busy = false;
    go.disabled = false;
  }
}

export function openImportDialog(): void {
  const el = ensureDialog();
  const urlInput = el.querySelector('#import-url') as HTMLInputElement;
  const pasteArea = el.querySelector('.import__paste') as HTMLDetailsElement;
  const status = el.querySelector('.import__status') as HTMLElement;

  status.hidden = true;
  paintService();

  // 没配服务就默认把"粘贴"那条路展开，别让人先撞一次失败
  pasteArea.open = !crawlConfigured();
  if (!el.open) el.showModal();
  if (crawlConfigured()) urlInput.focus();
  else (el.querySelector('#import-paste') as HTMLTextAreaElement).focus();
}

export function initImportDialog(): void {
  // 入口在左栏「新建文章」下面；产物是一篇草稿，所以始终落在文章分区
  $('post-import').addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('.sidebar__tab[data-tab="post"]')?.click();
    openImportDialog();
  });
}
