#!/usr/bin/env python3
"""把页面宠物用的 Live2D 模型同步到 public/live2d/。

模型来自 https://github.com/imuncle/live2d （Cubism 2 格式）。
整仓 444 MB、128 个模型，只取用到的这四个。

**清单不是手写的，是从每个模型的 index.json 里解析出来的。**
之前是一份硬编码的文件列表（贴图数量都写死 4 张）—— 那种写法加第二个模型必然漏文件，
而漏掉的表现是「模型加载不出来，但页面不报错、静默退回内置精灵」，很难查。
现在改由 index.json 决定拉什么：model / textures / physics / pose / motions / expressions。

目录结构必须和仓库保持 1:1：
    "pose": "../general/pose.json"
    "file": "motions/../../general/mtn/idle_00.mtn"
一旦扁平化，这两处都会 404。`general/` 是四只共用的姿势与动作，只会拉一次。

脚本幂等：文件已存在就跳过，可以反复跑。要强制重下加 --force。

用法：
    python scripts/fetch_live2d.py
    python scripts/fetch_live2d.py --only blanc_classic
    python scripts/fetch_live2d.py --force
"""

from __future__ import annotations

import argparse
import json
import posixpath
import subprocess
import sys
from pathlib import Path

REPO = "https://raw.githubusercontent.com/imuncle/live2d/master"
ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "public" / "live2d"

MODEL_DIR = "model/HyperdimensionNeptunia"

# 取景微调：上游给每个模型都设了负的 layout.center_y（blanc -0.6 / neptune -0.4 /
# noir -0.8 / vert -0.7），效果是把角色整体往下推、在画布**顶部**留出一块空白。
# 那块空白不只是难看 —— WebGL 画布整块都吃指针事件，它会挡住右下角那一片正文。
# 统一归零后角色基本填满画布（blanc 实测宽 87%、高 94%）。
#
# 放在脚本里而不是手动改文件：手动改的下场是下次 --force 重下就没了，
# 而表现是「某一只有块空白挡着正文」，很难联想到是资源被覆盖回去。
CENTER_Y = 0

# 必须与 src/data/pet.ts 里 characters[].model 一一对应。
# 对不上的后果是「那只角色永远只显示内置精灵」—— 不报错，只是静默降级，
# 所以加角色时这里和角色表要一起改。
MODELS = [
    "blanc_classic",  # 布兰
    "neptune_classic",  # 涅普顿
    "noir_classic",  # 诺瓦露（上游拼作 noir，不是 noire）
    "vert_classic",  # 贝露
]

# 运行时：Cubism 2 的 web 包，自带 core，不依赖 LAppDefine.js。四只共用
RUNTIME = "js/live2d.js"


def human(n: int) -> str:
    return f"{n / 1048576:.2f} MB" if n >= 1048576 else f"{n / 1024:.0f} KB"


# 统一的 curl 参数。两个都不是可选项：
#   --tls-max 1.2  某些网络/代理链路下 TLS 1.3 握手会被中间设备掐断，表现为
#                  `curl: (56) schannel: server closed abruptly (missing close_notify)`，
#                  而且是**单次请求就失败**（不是限流）。限到 1.2 立刻正常，1.2 本身也够安全。
#   --retry 3      raw.githubusercontent.com 偶发连接重置，重试一下比抱着日志查快
CURL = ["curl", "-sSL", "--fail", "--tls-max", "1.2", "--retry", "3", "--retry-delay", "1"]


def fetch_text(url: str) -> str:
    """拉一个小文件进内存。清单要先解析才知道下什么，所以不能直接写盘"""
    r = subprocess.run([*CURL, "-m", "60", url], capture_output=True, text=True)
    if r.returncode != 0:
        raise OSError(r.stderr.strip()[:120] or f"curl rc={r.returncode}")
    return r.stdout


def download(url: str, dst: Path, force: bool) -> tuple[str, int]:
    """返回 (状态, 字节数)。状态取 skip / get / fail。"""
    if dst.exists() and not force:
        return "skip", dst.stat().st_size

    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(dst.suffix + ".part")
    # 用 curl 而不是 urllib：这台机器上 curl 走代理是通的
    r = subprocess.run(
        [*CURL, "-m", "180", "-o", str(tmp), url],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0 or not tmp.exists() or tmp.stat().st_size == 0:
        tmp.unlink(missing_ok=True)
        print(f"    !! curl 失败 rc={r.returncode} {r.stderr.strip()[:120]}", file=sys.stderr)
        return "fail", 0

    tmp.replace(dst)
    return "get", dst.stat().st_size


def fix_layout(path: Path) -> bool:
    """把 index.json 的 layout.center_y 归零，返回是否真的改动过。

    重写整个文件会让缩进风格统一（原文件 tab 与空格混用），无所谓 ——
    这个文件只被运行时读，格式不影响它。
    """
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    layout = spec.get("layout")
    if not isinstance(layout, dict) or layout.get("center_y") == CENTER_Y:
        return False
    layout["center_y"] = CENTER_Y
    path.write_text(json.dumps(spec, ensure_ascii=False, indent=4), encoding="utf-8")
    return True


def resolve(base: str, ref: str) -> str:
    """把 index.json 里的相对引用解析成仓库内的相对路径。

    基准是**模型目录**（index.json 就躺在它里面），引用里带几层 ../ 都正常：
        '../general/pose.json'                  → .../general/pose.json
        'motions/../../general/mtn/idle_00.mtn' → .../general/mtn/idle_00.mtn
    """
    return posixpath.normpath(posixpath.join(base, ref))


def files_for(name: str) -> list[str]:
    """拉一个模型的 index.json，解析出它需要的全部文件（仓库内相对路径，有序去重）"""
    base = f"{MODEL_DIR}/{name}"
    try:
        spec = json.loads(fetch_text(f"{REPO}/{base}/index.json"))
    except json.JSONDecodeError as error:
        raise OSError(f"index.json 不是合法 JSON：{error}") from error

    out: list[str] = [f"{base}/index.json"]

    def add(ref: object) -> None:
        # 字段缺失或格式不对就跳过：不同模型的可选块差别很大（有的没 physics、
        # 有的没有动作），不能用同一套假设去套
        if isinstance(ref, str) and ref:
            path = resolve(base, ref)
            if path not in out:
                out.append(path)

    add(spec.get("model"))
    for item in spec.get("textures") or []:
        add(item)
    add(spec.get("physics"))
    add(spec.get("pose"))
    for group in (spec.get("motions") or {}).values():
        if not isinstance(group, list):
            continue
        for motion in group:
            if isinstance(motion, dict):
                add(motion.get("file"))
    # Cubism 2 的 index.json 也可能带表情块，有就一起拉
    for item in spec.get("expressions") or []:
        if isinstance(item, dict):
            add(item.get("file"))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="忽略本地已有文件，全部重下")
    ap.add_argument(
        "--only",
        metavar="NAME",
        action="append",
        help=f"只同步指定模型（可重复）。可选：{', '.join(MODELS)}",
    )
    args = ap.parse_args()

    wanted = args.only or MODELS
    unknown = [n for n in wanted if n not in MODELS]
    if unknown:
        print(f"!! 认不出的模型名：{', '.join(unknown)}", file=sys.stderr)
        print(f"   可选：{', '.join(MODELS)}", file=sys.stderr)
        return 2

    print(f"目标目录 {DEST}")

    # 先把清单凑齐（去重），再统一下载 —— 四只共用 general/ 下的姿势与动作，
    # 去重之后那几份不会重复拉
    plan: list[str] = []
    seen: set[str] = set()
    failed: list[str] = []

    def push(rel: str) -> None:
        if rel not in seen:
            seen.add(rel)
            plan.append(rel)

    push(RUNTIME)
    for name in wanted:
        try:
            for rel in files_for(name):
                push(rel)
        except OSError as error:
            print(f"  [x] {name}: 拿不到 index.json（{error}）", file=sys.stderr)
            failed.append(f"{MODEL_DIR}/{name}/index.json")

    total = 0
    for rel in plan:
        status, size = download(f"{REPO}/{rel}", DEST / rel, args.force)
        total += size
        mark = {"skip": "=", "get": "+", "fail": "x"}[status]
        print(f"  [{mark}] {human(size):>9}  {rel}")
        if status == "fail":
            failed.append(rel)

    print(f"\n合计 {human(total)}，{len(plan)} 个文件，{len(wanted)} 个模型")

    # 取景微调。**不能跟着上面那段下载一起被跳过** —— 文件已存在时下载全走 skip，
    # 而 center_y 是要在已有文件上修的，所以这一步每次都跑（见 CENTER_Y 的说明）
    for name in wanted:
        idx = DEST / MODEL_DIR / name / "index.json"
        if idx.exists() and fix_layout(idx):
            print(f"  [~] {name} 的 layout.center_y 已归零")

    # 逐模型校验魔数：避免代理返回错误页却被当成贴图/模型存下来。
    # 这种坏文件在页面上表现为「资源 200 但模型空白」，比 404 更难查
    for name in wanted:
        moc = DEST / MODEL_DIR / name / "model.moc"
        if moc.exists() and not moc.read_bytes().startswith(b"moc"):
            print(f"!! {name}/model.moc 魔数不对（应为 moc）", file=sys.stderr)
            failed.append(str(moc))

        textures = DEST / MODEL_DIR / name / "textures.1024"
        if textures.is_dir():
            for png in sorted(textures.glob("*.png")):
                if png.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
                    print(f"!! {png.relative_to(DEST)} 不是合法 PNG", file=sys.stderr)
                    failed.append(str(png))

    if failed:
        print(f"\n失败 {len(failed)} 项：", file=sys.stderr)
        for f in failed:
            print(f"  - {f}", file=sys.stderr)
        return 1

    print("全部就位。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
