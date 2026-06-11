#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"

publish_args=()

log_error() {
  echo "[ERROR] $*" >&2
}

usage() {
  cat <<'EOF'
Usage: npm run publish:github -- [options]

Create or update the GitHub Release for the current package version, upload all
release assets, and verify the uploaded assets.

Options:
  --notes-file <path>  Release notes file used when creating a new release.
  --repo <owner/name>  GitHub repository. Default: GITHUB_REPOSITORY or jinhx128/agentmesh.
  --allow-dirty        Allow publishing from a dirty working tree.
  --skip-build         Reuse existing build output and DMG when preparing assets.
  -h, --help           Show this help.

Examples:
  npm run publish:github -- --notes-file release-notes.md
  npm run publish:github -- --skip-build
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes-file)
      [[ $# -ge 2 ]] || { log_error "--notes-file requires a value"; exit 1; }
      publish_args+=(--notes-file "$2")
      shift 2
      ;;
    --repo)
      [[ $# -ge 2 ]] || { log_error "--repo requires a value"; exit 1; }
      publish_args+=(--repo "$2")
      shift 2
      ;;
    --allow-dirty)
      publish_args+=(--allow-dirty)
      shift
      ;;
    --skip-build)
      publish_args+=(--skip-build)
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log_error "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

main() {
  cd "${ROOT_DIR}" || exit 1

  gh auth status >/dev/null

  node scripts/github-release.mjs "${publish_args[@]}"
}

main "$@"
