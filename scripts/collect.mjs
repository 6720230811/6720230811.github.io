#!/usr/bin/env node
/**
 * 拾遗 / Gleanings —— 抓取脚本（GitHub star）
 *
 *   node scripts/collect.mjs
 *
 * 产出 `src/data/gleanings/stars.json`。这份快照是**唯一真相源**，
 * 页面在构建期读它，而它是这个脚本每天在 CI 里重写的。
 *
 * ---------------------------------------------------------------------------
 * 为什么是 Node 而不是 Python（`scripts/` 下另两个脚本是 Python）
 *
 * 它在 CI 里跑，而 CI 用的是 `withastro/action` —— Node 已经装好，
 * 不需要多一步环境准备。将来若要把 `src/lib/gleanings.ts` 的 zod schema
 * 用 esbuild 打进这个脚本共用同一份校验，language 上也同源。
 *
 * ---------------------------------------------------------------------------
 * 为什么这个脚本只写 stars.json
 *
 * `links.json` / `now.json` / `stars-curated.json` 是**手写**的，
 * 抓取脚本永远不碰。一旦脚本有权覆盖手写文件，某天源改版就会把写的东西擦掉。
 *
 * ---------------------------------------------------------------------------
 * 四道守卫（命中任一条即**不写文件**，旧快照原样留着）
 *
 *   ① 请求失败 / 非 200
 *   ② 抓到 0 条
 *   ③ 条目数骤降（低于上次的 60%）
 *   ④ 写入前形状校验不过
 *
 * 这类页面最常见的死法不是抓不到，而是**抓坏了把好数据擦掉** ——
 * 源改版返回半截、或被限流返回空数组，一次覆盖就把积累全清了。
 * 四道守卫换个说法就是：**宁可数据旧，不可数据烂。**
 *
 * 命中守卫时以非零码退出（CI 标红），但站点照旧用旧快照构建部署。
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OWNER = process.env.GLEANINGS_OWNER ?? '6720230811';
const OUT = fileURLToPath(new URL('../src/data/gleanings/stars.json', import.meta.url));

/** 单页 100 条，最多翻 10 页（1000 个 star）—— 再多就该换思路了，不是把页数调大 */
const PER_PAGE = 100;
const MAX_PAGES = 10;

/** 条目数骤降阈值：新数据少于旧数据的这个比例就拒绝写入 */
const SHRINK_FLOOR = 0.6;

class GuardError extends Error {
  constructor(guard, message) {
    super(`守卫 ${guard} 拦下：${message}`);
    this.name = 'GuardError';
  }
}

/**
 * 读现有快照。读不到（首次运行）返回 null —— 那时守卫 ③ 自动跳过。
 * **解析失败也返回 null**：一份坏掉的旧文件不该让脚本连数据都不去抓。
 */
async function readPrevious() {
  try {
    const parsed = JSON.parse(await readFile(OUT, 'utf8'));
    const repos = Array.isArray(parsed?.repos) ? parsed.repos : null;
    return repos ? { count: repos.length, fetchedAt: parsed.fetchedAt } : null;
  } catch {
    return null;
  }
}

/**
 * 抓 star 列表。
 *
 * 用 `application/vnd.github.star+json` 这个 Accept：它会多给一个 `starred_at`
 * （加星时间），而**不带这个头就没有**。代价是外层包了一层 `{ starred_at, repo }`。
 * 下面两种形态都认 —— 万一哪天默认形态变了，脚本不会静默把 `repo` 当成仓库对象、
 * 把 `starred_at` 当成名字。
 */
async function fetchStarred() {
  const repos = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `https://api.github.com/users/${OWNER}/starred?per_page=${PER_PAGE}&page=${page}&sort=created&direction=desc`;

    let res;
    try {
      res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github.star+json',
          'User-Agent': 'gleanings-collect',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    } catch (err) {
      throw new GuardError('①', `请求 ${url} 失败：${err.message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 403 多半是限流，把 GitHub 自己的话透出来 —— 只说状态码等于让人对着 403 猜
      const hint = res.status === 403 ? '（多半是未认证限流，一小时 60 次）' : '';
      throw new GuardError('①', `HTTP ${res.status}${hint}：${body.slice(0, 200)}`);
    }

    const batch = await res.json();
    if (!Array.isArray(batch)) {
      throw new GuardError('①', `期望数组，拿到 ${typeof batch}`);
    }

    for (const item of batch) {
      const repo = item?.repo ?? item;
      if (!repo?.full_name) continue;
      repos.push({
        fullName: repo.full_name,
        url: repo.html_url,
        description: repo.description ?? null,
        language: repo.language ?? null,
        stars: repo.stargazers_count ?? 0,
        forks: repo.forks_count ?? 0,
        pushedAt: repo.pushed_at ?? null,
        starredAt: item?.starred_at ?? null,
        archived: repo.archived === true,
      });
    }

    if (batch.length < PER_PAGE) break;
  }

  return repos;
}

/** 守卫 ②③：数量本身是否可信 */
function assertPlausible(repos, previous) {
  if (repos.length === 0) {
    throw new GuardError('②', '抓到 0 条 —— 宁可用旧快照');
  }
  if (previous && previous.count > 0) {
    const floor = Math.floor(previous.count * SHRINK_FLOOR);
    if (repos.length < floor) {
      throw new GuardError(
        '③',
        `只剩 ${repos.length} 条，少于上次 ${previous.count} 条的 ${SHRINK_FLOOR * 100}%（${floor} 条）`
      );
    }
  }
}

/** 守卫 ④：形状校验。**粗检**，严格的那道在 src/lib/gleanings.ts（构建期 zod） */
function assertShape(repos) {
  for (const r of repos) {
    const bad =
      typeof r.fullName !== 'string' ||
      typeof r.url !== 'string' ||
      !r.url.startsWith('https://') ||
      typeof r.stars !== 'number' ||
      (r.description !== null && typeof r.description !== 'string');
    if (bad) {
      throw new GuardError('④', `条目形状不对：${JSON.stringify(r).slice(0, 160)}`);
    }
  }

  const seen = new Set();
  for (const r of repos) {
    if (seen.has(r.fullName)) throw new GuardError('④', `重复条目：${r.fullName}`);
    seen.add(r.fullName);
  }
}

async function main() {
  const previous = await readPrevious();

  const repos = await fetchStarred();
  assertPlausible(repos, previous);
  assertShape(repos);

  const snapshot = {
    source: 'github',
    owner: OWNER,
    fetchedAt: new Date().toISOString(),
    repos,
  };

  // 格式化写入：这是要进 git、要被人读的文件，一行一条比压成一行好审
  await writeFile(OUT, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  const delta = previous ? repos.length - previous.count : null;
  console.log(`✓ 写入 ${repos.length} 个仓库 → src/data/gleanings/stars.json`);
  console.log(`  上次快照：${previous ? `${previous.count} 个（${previous.fetchedAt}）` : '无（首次运行）'}`);
  if (delta !== null && delta !== 0) console.log(`  数量变化：${delta > 0 ? '+' : ''}${delta}`);
}

/**
 * 只在「被当作脚本直接执行」时跑 main()，被 import 时什么都不做 ——
 * 四道守卫是这套设计的安全阀，必须能被探针直接驱动。
 *
 * **用文件名判断，而不是 `import.meta.url === pathToFileURL(process.argv[1]).href`
 * 那个常见写法。** 探针会把本文件用 esbuild 打进 `probe-gleanings.out.mjs`：
 * 那时 `import.meta.url` 指向打包产物，而 `process.argv[1]` 也是它 —— 两边相等，
 * 于是探针只要 import 一下就会把整趟抓取跑起来（还会重写 stars.json）。
 * 比文件名就没这个问题。文件改名的话记得同步这一行。
 */
const isEntry = import.meta.url.endsWith('/collect.mjs');
export {
  OWNER,
  OUT,
  SHRINK_FLOOR,
  GuardError,
  readPrevious,
  fetchStarred,
  assertPlausible,
  assertShape,
};

if (isEntry) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    console.error('  旧快照保持不动，站点会用上一次的数据继续部署。');
    process.exitCode = 1;
  });
}
