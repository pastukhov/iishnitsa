#!/usr/bin/env bash
set -euo pipefail

branch_name="$(git branch --show-current)"
origin_main_ref="refs/remotes/origin/main"

if [[ -z "$branch_name" ]]; then
  echo "Unable to determine the current branch."
  exit 1
fi

if [[ "$branch_name" == "main" ]]; then
  echo "Refusing to push from local 'main'. Create a short-lived branch from 'origin/main' first."
  exit 1
fi

if ! git show-ref --verify --quiet "$origin_main_ref"; then
  echo "Missing local ref for origin/main. Run 'git fetch origin main' before pushing."
  exit 1
fi

origin_main_sha="$(git rev-parse "$origin_main_ref")"
merge_base_sha="$(git merge-base HEAD "$origin_main_ref")"

if [[ "$merge_base_sha" != "$origin_main_sha" ]]; then
  echo "Current branch is not based on the latest origin/main."
  echo "merge-base:  $merge_base_sha"
  echo "origin/main: $origin_main_sha"
  echo "Rebase or recreate the branch from origin/main before pushing."
  exit 1
fi

exit 0
