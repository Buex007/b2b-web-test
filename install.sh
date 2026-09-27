#!/bin/sh
# install.sh — put this skill where agents look for skills.
#
# Portable by construction: POSIX sh, works from any clone location, for any
# macOS user, and does not assume which agent is installed — it detects the
# skill roots that exist on this machine and links into each of them.

set -u

SKILL_NAME="b2b-web-test"

_self="$0"
while [ -h "$_self" ]; do
  _dir=$(cd -P "$(dirname "$_self")" >/dev/null 2>&1 && pwd)
  _link=$(readlink "$_self")
  case "$_link" in
    /*) _self="$_link" ;;
    *) _self="$_dir/$_link" ;;
  esac
done
SKILL_ROOT=$(cd -P "$(dirname "$_self")" >/dev/null 2>&1 && pwd)

HOME_DIR=${HOME:-}
[ -n "$HOME_DIR" ] || HOME_DIR=$(cd ~ >/dev/null 2>&1 && pwd)

MODE="symlink"
DO_INIT=1
DRY=0
EXPLICIT_ROOTS=""

usage() {
  cat <<'EOF'
用法： sh install.sh [选项]

  --copy            拷贝而不是软链（默认软链，git pull 即生效）
  --root <目录>     指定技能根目录（可重复；默认自动探测）
  --no-init         只安装，不运行 b2b-test init
  --dry-run         只显示会做什么，不动文件系统
  -h, --help        显示本帮助
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --copy) MODE="copy"; shift ;;
    --root) EXPLICIT_ROOTS="$EXPLICIT_ROOTS ${2:-}"; shift 2 ;;
    --no-init) DO_INIT=0; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf '未知选项：%s\n' "$1" >&2; usage; exit 1 ;;
  esac
done

say() { printf '%s\n' "$*"; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }

say "b2b-web-test 安装"
say "源目录：$SKILL_ROOT"
say ""

# ---------------------------------------------------------------- pick roots
ROOTS=""
add_root() {
  [ -n "$1" ] || return 0
  [ -d "$1" ] || return 0
  case " $ROOTS " in
    *" $1 "*) return 0 ;;
  esac
  ROOTS="$ROOTS $1"
}

if [ -n "$EXPLICIT_ROOTS" ]; then
  for r in $EXPLICIT_ROOTS; do add_root "$r"; done
else
  add_root "$HOME_DIR/.codex/skills"
  add_root "$HOME_DIR/.claude/skills"
  add_root "$HOME_DIR/.agents/skills"
  [ -n "${CODEX_HOME:-}" ] && add_root "$CODEX_HOME/skills"
fi

if [ -z "$ROOTS" ]; then
  say "没有探测到任何技能目录（~/.codex/skills、~/.claude/skills、~/.agents/skills 都不存在）。"
  say "将创建 ~/.codex/skills（Codex 约定位置）。"
  if [ "$DRY" = "0" ]; then
    mkdir -p "$HOME_DIR/.codex/skills" || die "无法创建技能目录"
  fi
  ROOTS=" $HOME_DIR/.codex/skills"
fi

# --------------------------------------------------------------------- link
linked=0
for root in $ROOTS; do
  target="$root/$SKILL_NAME"
  if [ -e "$target" ] || [ -L "$target" ]; then
    resolved=$(cd -P "$target" >/dev/null 2>&1 && pwd || printf '%s' "$target")
    if [ "$resolved" = "$SKILL_ROOT" ]; then
      say "已是同一份：$target"
      linked=$((linked + 1))
      continue
    fi
    say "跳过（已存在，未覆盖）：$target"
    continue
  fi
  case "$root" in
    "$SKILL_ROOT"*) say "跳过（已在技能目录内）：$target"; continue ;;
  esac
  if [ "$DRY" = "1" ]; then
    say "（演练）${MODE}：$target -> $SKILL_ROOT"
    linked=$((linked + 1))
    continue
  fi
  if [ "$MODE" = "copy" ]; then
    cp -R "$SKILL_ROOT" "$target" || die "拷贝失败：$target"
    say "已拷贝：$target"
  else
    ln -s "$SKILL_ROOT" "$target" || die "创建软链失败：$target"
    say "已软链：$target -> $SKILL_ROOT"
  fi
  linked=$((linked + 1))
done

say ""
if [ "$linked" -eq 0 ]; then
  say "没有新增安装位置（都已存在）。"
else
  say "安装到 $linked 个技能目录。"
fi

# ------------------------------------------------------------------ init
if [ "$DO_INIT" = "1" ] && [ "$DRY" = "0" ]; then
  say ""
  say "接下来做初始化（装 ego lite / 配 Jev / 离线自检）："
  if [ -x "$SKILL_ROOT/bin/b2b-test" ]; then
    "$SKILL_ROOT/bin/b2b-test" init || {
      say ""
      say "初始化没有全部完成，可以稍后重试：$SKILL_ROOT/bin/b2b-test init"
      exit 1
    }
  else
    die "bin/b2b-test 不可执行，请检查仓库完整性"
  fi
else
  say ""
  say "跳过初始化。稍后手动执行："
  say "  $SKILL_ROOT/bin/b2b-test init"
fi
