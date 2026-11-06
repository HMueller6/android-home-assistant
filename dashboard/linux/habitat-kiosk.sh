#!/usr/bin/env bash
# Opens the Habitat dashboard on Linux, full screen (kiosk) or in its own app window.
#
# Usage: habitat-kiosk.sh [--window] [URL]
#   URL       dashboard address; defaults to $HABITAT_URL, then
#             http://homeassistant.local:8123/local/habitat/index.html
#   --window  open a normal app window instead of full-screen kiosk mode
#
# Environment:
#   HABITAT_URL       dashboard address
#   HABITAT_BROWSER   browser command to use (default: first found of Chromium, Chrome, Brave, Edge, Firefox)
#   HABITAT_NO_BLANK  set to 1 to stop an X11 screen from blanking (wall displays)
set -euo pipefail

readonly DEFAULT_URL="http://homeassistant.local:8123/local/habitat/index.html"
readonly PROFILE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/habitat-kiosk"
readonly CANDIDATES=(chromium chromium-browser google-chrome google-chrome-stable brave-browser microsoft-edge firefox)

mode="kiosk"
url="${HABITAT_URL:-$DEFAULT_URL}"

for arg in "$@"; do
  case "$arg" in
    --window) mode="window" ;;
    -h | --help)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "Unknown option: $arg (see --help)" >&2
      exit 2
      ;;
    *) url="$arg" ;;
  esac
done

pick_browser() {
  if [[ -n "${HABITAT_BROWSER:-}" ]]; then
    echo "$HABITAT_BROWSER"
    return 0
  fi
  local candidate
  for candidate in "${CANDIDATES[@]}"; do
    if command -v "$candidate" > /dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

if ! browser="$(pick_browser)"; then
  echo "No supported browser found. Install Chromium or Firefox, or set HABITAT_BROWSER." >&2
  exit 1
fi

if [[ "${HABITAT_NO_BLANK:-0}" == "1" && -n "${DISPLAY:-}" ]] && command -v xset > /dev/null 2>&1; then
  xset s off s noblank -dpms || echo "Could not disable screen blanking (xset failed)." >&2
fi

case "$(basename "$browser")" in
  firefox*)
    if [[ "$mode" == "kiosk" ]]; then
      exec "$browser" --kiosk "$url"
    fi
    exec "$browser" --new-window "$url"
    ;;
  *)
    # A dedicated profile keeps the dashboard's sign-in separate from everyday browsing.
    mkdir -p "$PROFILE_DIR"
    flags=(
      --app="$url"
      --user-data-dir="$PROFILE_DIR"
      --no-first-run
      --no-default-browser-check
      --disable-translate
      --disable-session-crashed-bubble
      --noerrdialogs
      --overscroll-history-navigation=0
      --check-for-update-interval=31536000
    )
    if [[ "$mode" == "kiosk" ]]; then
      flags+=(--kiosk)
    fi
    exec "$browser" "${flags[@]}"
    ;;
esac
