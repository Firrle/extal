#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

case "$(uname -s)" in
	Linux*)
		expected_electron_path="electron"
		;;
	Darwin*)
		expected_electron_path="Electron.app/Contents/MacOS/Electron"
		;;
	MINGW*|MSYS*|CYGWIN*|Windows_NT)
		expected_electron_path="electron.exe"
		;;
	*)
		expected_electron_path=""
		;;
esac

electron_path_file="$SCRIPT_DIR/node_modules/electron/path.txt"

# Prevent a shell-level npm platform override from forcing the wrong Electron binary.
unset npm_config_platform npm_config_arch npm_config_target_platform npm_config_target_arch
unset NPM_CONFIG_PLATFORM NPM_CONFIG_ARCH NPM_CONFIG_TARGET_PLATFORM NPM_CONFIG_TARGET_ARCH

if [ -n "$expected_electron_path" ] && [ -f "$electron_path_file" ]; then
	installed_electron_path="$(tr -d '\r\n' < "$electron_path_file")"
	if [ "$installed_electron_path" != "$expected_electron_path" ] || [ ! -e "$SCRIPT_DIR/node_modules/electron/dist/$expected_electron_path" ]; then
		echo "Electron binary mismatch detected for $(uname -s). Rebuilding Electron for this platform..."
		npm rebuild electron
	fi
fi

npm start
