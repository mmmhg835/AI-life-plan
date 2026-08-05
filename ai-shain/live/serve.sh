#!/usr/bin/env bash
# 町を配る。Mac が寝ないように押さえつつ、見に行ける住所を全部出す。
#   使い方:  ai-shain/live/serve.sh [ポート番号]
set -eu

PORT="${1:-8899}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TOWN="$(dirname "$HERE")"          # ai-shain/
cd "$TOWN"

# 実況ログを町の隣に置く。無ければ模擬のまま動くだけなので、失敗しても止めない。
SRC="${AI_SHAIN_DIR:-$HOME/.claude/ai-shain}/events.jsonl"
if [ ! -e events.jsonl ] && [ -f "$SRC" ]; then
  ln -s "$SRC" events.jsonl && echo "実況をつなぎました： $SRC"
fi
if [ ! -e events.jsonl ]; then
  echo "実況ログがまだありません。模擬のまま動きます（live/README.md を参照）"
fi

echo
echo "  この Mac から    http://localhost:$PORT/"

lan="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -n "$lan" ]; then
  echo "  同じ Wi-Fi から  http://$lan:$PORT/"
fi

ts="$(tailscale ip -4 2>/dev/null | head -n1 || true)"
if [ -n "$ts" ]; then
  echo "  外出先から       http://$ts:$PORT/"
else
  echo "  外出先から       （Tailscale を入れるとここに住所が出ます）"
fi
echo

# caffeinate があるあいだ Mac は寝ない。Ctrl-C で両方とも終わる。
if command -v caffeinate >/dev/null 2>&1; then
  exec caffeinate -i python3 -m http.server "$PORT"
else
  exec python3 -m http.server "$PORT"
fi
