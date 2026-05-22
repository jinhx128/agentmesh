#!/usr/bin/env bash
set -Eeuo pipefail

prompt_file=""
output_file=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt-file)
      prompt_file="$2"
      shift 2
      ;;
    --output-file)
      output_file="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "${prompt_file}" ]]; then
  echo "missing --prompt-file" >&2
  exit 2
fi

if [[ -n "${output_file}" ]]; then
  {
    echo "fake agent received:"
    cat "${prompt_file}"
  } > "${output_file}"
else
  echo "fake agent received:"
  cat "${prompt_file}"
fi
