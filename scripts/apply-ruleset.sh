#!/bin/sh
# Applies .github/rulesets/main.json to the GitHub repository (repo admin only).
# Free on this public repository (DEC-23). Denied to Claude in .claude/settings.json.
set -eu
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
existing=$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "main") | .id')
if [ -n "$existing" ]; then
  gh api -X PUT "repos/$repo/rulesets/$existing" --input .github/rulesets/main.json >/dev/null
  echo "Updated ruleset main ($existing) on $repo"
else
  gh api -X POST "repos/$repo/rulesets" --input .github/rulesets/main.json >/dev/null
  echo "Created ruleset main on $repo"
fi
