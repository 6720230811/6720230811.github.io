import { repo } from '../../data/admin';
import { findRun, failedSteps, GhError, type WorkflowRun } from './github';
import { readToken } from './token';

/**
 * 发布之后盯着 Actions 的构建结果。
 *
 * 提交刚写完时 workflow run 还没建出来，所以先等一会儿再去问，
 * 之后每 5 秒问一次，直到 completed（run 的状态每次都要重查，缓存下来就永远不动了）。
 * token 没有 Actions 读权限时（细粒度 PAT 默认只给 Contents）拿不到状态，
 * 这种情况不报错，交给调用方降级成「已提交，去 Actions 页面看」。
 */

export type BuildPhase = 'success' | 'failure' | 'timeout' | 'no-permission';

export interface BuildResult {
  phase: BuildPhase;
  run?: WorkflowRun;
  /** 失败的步骤名（job → step） */
  steps: string[];
  seconds: number;
}

const FIRST_DELAY = 4000;
const INTERVAL = 5000;
const MAX_MS = 4 * 60 * 1000;
/** 一直查不到这次提交的 run，多半是没权限（或者 workflow 没被这次 push 触发） */
const GIVE_UP = 60 * 1000;

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export async function waitForBuild(commitSha: string | null): Promise<BuildResult> {
  const token = readToken();
  if (!token || !commitSha) return { phase: 'no-permission', steps: [], seconds: 0 };

  const t0 = Date.now();
  const seconds = () => Math.round((Date.now() - t0) / 1000);

  await sleep(FIRST_DELAY);

  while (Date.now() - t0 < MAX_MS) {
    let run: WorkflowRun | null = null;
    try {
      run = await findRun(repo, token, commitSha);
    } catch (e) {
      if (e instanceof GhError && (e.status === 403 || e.status === 404)) {
        return { phase: 'no-permission', steps: [], seconds: seconds() };
      }
      // 限流之类的：再等一轮试试，不直接判死
      await sleep(INTERVAL);
      continue;
    }

    if (run) {
      if (run.status === 'completed') {
        if (run.conclusion === 'success') {
          return { phase: 'success', run, steps: [], seconds: seconds() };
        }
        const steps = await failedSteps(repo, token, run.id);
        return { phase: 'failure', run, steps, seconds: seconds() };
      }
    } else if (Date.now() - t0 > GIVE_UP) {
      return { phase: 'no-permission', steps: [], seconds: seconds() };
    }

    await sleep(INTERVAL);
  }

  return { phase: 'timeout', steps: [], seconds: seconds() };
}
