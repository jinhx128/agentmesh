#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"

dry_run=false
allow_dirty=false
skip_build=false
skip_smoke=false
skip_published_check=false
tag="latest"
otp=""
tmp_dir=""

cleanup_tmp() {
  if [[ -n "${tmp_dir:-}" ]]; then
    rm -rf -- "${tmp_dir}"
  fi
}

trap cleanup_tmp EXIT

log_info() {
  echo "[INFO] $*" >&2
}

log_warn() {
  echo "[WARN] $*" >&2
}

log_error() {
  echo "[ERROR] $*" >&2
}

usage() {
  cat <<'EOF'
Usage: npm run publish:npm -- [options]

Publish the root AgentMesh package to the public npm registry.

Options:
  --dry-run                 Build, smoke test, and run npm publish --dry-run.
  --otp <code>              Pass a two-factor auth one-time password to npm.
  --tag <tag>               npm dist-tag to publish. Default: latest.
  --registry <url>          npm registry. Default: package publishConfig.registry.
  --allow-dirty             Allow publishing with local git changes.
  --skip-build              Reuse existing dist-node output.
  --skip-smoke              Skip the clean install smoke test.
  --skip-published-check    Skip checking whether this version already exists.
  -h, --help                Show this help.

Examples:
  npm run publish:npm
  npm run publish:npm -- --otp 123456
  npm run publish:npm -- --dry-run
EOF
}

json_field() {
  local expression="$1"
  node -e "const fs = require('node:fs'); const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); const value = ${expression}; if (value !== undefined && value !== null) console.log(value);"
}

ensure_tmp_dir() {
  if [[ -z "${tmp_dir}" ]]; then
    tmp_dir="$(mktemp -d)"
  fi
}

registry=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      dry_run=true
      shift
      ;;
    --otp)
      [[ $# -ge 2 ]] || { log_error "--otp requires a value"; exit 1; }
      otp="$2"
      shift 2
      ;;
    --tag)
      [[ $# -ge 2 ]] || { log_error "--tag requires a value"; exit 1; }
      tag="$2"
      shift 2
      ;;
    --registry)
      [[ $# -ge 2 ]] || { log_error "--registry requires a value"; exit 1; }
      registry="$2"
      shift 2
      ;;
    --allow-dirty)
      allow_dirty=true
      shift
      ;;
    --skip-build)
      skip_build=true
      shift
      ;;
    --skip-smoke)
      skip_smoke=true
      shift
      ;;
    --skip-published-check)
      skip_published_check=true
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

  local package_name
  local package_version
  local package_private
  package_name="$(json_field "pkg.name")"
  package_version="$(json_field "pkg.version")"
  package_private="$(json_field "pkg.private === true ? 'true' : 'false'")"
  registry="${registry:-$(json_field "pkg.publishConfig?.registry ?? 'https://registry.npmjs.org/'")}"

  if [[ "${package_private}" == "true" ]]; then
    log_error "${package_name}@${package_version} is private and cannot be published."
    exit 1
  fi

  assert_clean_tree
  assert_npm_login
  assert_scope_access "${package_name}"
  assert_version_not_published "${package_name}" "${package_version}"

  if [[ "${skip_build}" == "false" ]]; then
    log_info "Building ${package_name}@${package_version}"
    npm run build
  fi

  if [[ "${skip_smoke}" == "false" ]]; then
    log_info "Running clean install smoke"
    npm run cli:install-smoke
  fi

  local publish_args=(publish --access public --tag "${tag}" --registry "${registry}")
  if [[ "${dry_run}" == "true" ]]; then
    publish_args+=(--dry-run)
  fi
  if [[ -n "${otp}" ]]; then
    publish_args+=(--otp "${otp}")
  fi

  log_info "Publishing ${package_name}@${package_version} to ${registry} with tag ${tag}"
  npm "${publish_args[@]}"
}

assert_clean_tree() {
  if [[ "${allow_dirty}" == "true" ]]; then
    return
  fi
  local status
  status="$(git status --porcelain)"
  if [[ -n "${status}" ]]; then
    log_error "Working tree is dirty. Commit/stash first, or pass --allow-dirty intentionally."
    echo "${status}" >&2
    exit 1
  fi
}

assert_npm_login() {
  if npm whoami --registry "${registry}" >/dev/null 2>&1; then
    return
  fi
  if [[ "${dry_run}" == "true" ]]; then
    log_warn "npm whoami failed for ${registry}; continuing because --dry-run was requested."
    return
  fi
  log_error "npm login is required for ${registry}. Run npm login first."
  exit 1
}

assert_scope_access() {
  local package_name="$1"
  if [[ "${package_name}" != @*/* ]]; then
    return
  fi
  if [[ "${dry_run}" == "true" ]]; then
    log_warn "Skipping npm scope access check for ${package_name} because --dry-run was requested."
    return
  fi

  local package_scope
  package_scope="${package_name%%/*}"
  ensure_tmp_dir
  if npm access ls-packages "${package_scope}" --registry "${registry}" --json >"${tmp_dir}/access.stdout" 2>"${tmp_dir}/access.stderr"; then
    return
  fi

  log_error "npm account cannot access scope ${package_scope} on ${registry}. Run npm login with an owner/maintainer account or request access before publishing."
  cat "${tmp_dir}/access.stderr" >&2
  exit 1
}

assert_version_not_published() {
  local package_name="$1"
  local package_version="$2"
  if [[ "${skip_published_check}" == "true" || "${dry_run}" == "true" ]]; then
    return
  fi

  ensure_tmp_dir

  if npm view "${package_name}@${package_version}" version --registry "${registry}" >"${tmp_dir}/stdout" 2>"${tmp_dir}/stderr"; then
    log_error "${package_name}@${package_version} is already published. npm versions cannot be overwritten."
    exit 1
  fi

  if grep -Eiq "E404|404|not found|No match found" "${tmp_dir}/stderr"; then
    return
  fi

  log_error "Could not confirm whether ${package_name}@${package_version} is unpublished."
  cat "${tmp_dir}/stderr" >&2
  exit 1
}

main "$@"
