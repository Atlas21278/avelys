#!/bin/sh
# Applies .github/rulesets/main.json to the GitHub repository (repo admin only).
# Requires GitHub Pro for a private repository owned by a personal account (DEC-23).
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
