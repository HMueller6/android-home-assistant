#!/usr/bin/env bash
# Installs a "Habitat" app launcher for the current Linux user (no root needed).
#
# Usage: ./install.sh URL [--autostart]
#   URL          dashboard address, e.g. http://homeassistant.local:8123/local/habitat/index.html
#   --autostart  also start Habitat full screen when you log in (wall displays)
#
# Installs:
#   ~/.local/bin/habitat-kiosk                        the launcher script
#   ~/.local/share/applications/habitat.desktop       menu entry (window, plus a full-screen action)
#   ~/.local/share/icons/hicolor/scalable/apps/habitat.svg
#   ~/.config/autostart/habitat.desktop               only with --autostart
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
url=""
autostart=0

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --autostart) autostart=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
    *) url="$arg" ;;
  esac
done

if [[ ! "$url" =~ ^https?://[^[:space:]\"\`\$\\]+$ ]]; then
  usage >&2
  echo >&2
  echo "Give the dashboard address, starting with http:// or https://." >&2
  exit 1
fi

bin_dir="${XDG_BIN_HOME:-$HOME/.local/bin}"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
apps_dir="$data_dir/applications"
icon_dir="$data_dir/icons/hicolor/scalable/apps"
autostart_dir="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
launcher="$bin_dir/habitat-kiosk"
# Desktop entries treat % as a field code, so a literal % is written as %%.
exec_url="${url//%/%%}"

mkdir -p "$bin_dir" "$apps_dir" "$icon_dir"
install -m 0755 "$here/habitat-kiosk.sh" "$launcher"
install -m 0644 "$here/../icon.svg" "$icon_dir/habitat.svg"

cat > "$apps_dir/habitat.desktop" << EOF
[Desktop Entry]
Type=Application
Name=Habitat
GenericName=Home dashboard
Comment=Home Assistant dashboard
Exec="$launcher" --window "$exec_url"
Icon=habitat
Terminal=false
Categories=Utility;
Keywords=home;assistant;dashboard;smart;
StartupNotify=false
Actions=fullscreen;

[Desktop Action fullscreen]
Name=Open full screen
Exec="$launcher" "$exec_url"
EOF
echo "Installed menu entry: $apps_dir/habitat.desktop"

if [[ "$autostart" -eq 1 ]]; then
  mkdir -p "$autostart_dir"
  cat > "$autostart_dir/habitat.desktop" << EOF
[Desktop Entry]
Type=Application
Name=Habitat (full screen)
Comment=Start the Home Assistant dashboard full screen at login
Exec="$launcher" "$exec_url"
Icon=habitat
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
  echo "Habitat will start full screen at login: $autostart_dir/habitat.desktop"
fi

if command -v update-desktop-database > /dev/null 2>&1; then
  update-desktop-database "$apps_dir" > /dev/null 2>&1 || true
fi

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) echo "Note: $bin_dir is not on your PATH; the menu entry works regardless." ;;
esac
echo "Done. Open Habitat from your app menu, or run: $launcher"
