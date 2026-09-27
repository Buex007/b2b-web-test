#!/bin/sh
# uninstall.sh — remove the skill links. Never touches your test records.

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

DRY=0
PURGE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --purge-data) PURGE=1; shift ;;
    -h|--help)
      cat <<'EOF'
用法： sh uninstall.sh [--dry-run] [--purge-data]

  默认只移除技能目录里的软链，记录（~/.local/share/b2b-web-test）保持不变。
  --purge-data  连记录一起删除（会二次确认）
EOF
      exit 0
      ;;
    *) printf '未知选项：%s\n' "$1" >&2; exit 1 ;;
  esac
done

for root in "$HOME_DIR/.codex/skills" "$HOME_DIR/.claude/skills" "$HOME_DIR/.agents/skills" "${CODEX_HOME:-}/skills"; do
  [ -n "$root" ] || continue
  target="$root/$SKILL_NAME"
  [ -e "$target" ] || [ -L "$target" ] || continue
  resolved=$(cd -P "$target" >/dev/null 2>&1 && pwd || printf '%s' "$target")
  if [ "$resolved" != "$SKILL_ROOT" ] && [ -L "$target" ]; then
    printf '跳过（指向别处）：%s\n' "$target"
    continue
  fi
  if [ "$DRY" = "1" ]; then
    printf '（演练）移除：%s\n' "$target"
  else
    rm -rf "$target"
    printf '已移除：%s\n' "$target"
  fi
done

if [ "$PURGE" = "1" ]; then
  DATA="${B2B_WEB_TEST_HOME:-$HOME_DIR/.local/share/b2b-web-test}"
  printf '将删除全部测试记录：%s\n' "$DATA"
  printf '确认请输入 yes：'
  read -r ans
  if [ "$ans" = "yes" ]; then
    rm -rf "$DATA"
    printf '已删除记录。\n'
  else
    printf '已取消，记录保留。\n'
  fi
else
  printf '记录目录未改动：%s\n' "${B2B_WEB_TEST_HOME:-$HOME_DIR/.local/share/b2b-web-test}"
fi
