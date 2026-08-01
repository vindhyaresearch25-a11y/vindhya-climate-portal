#!/bin/zsh
# push.sh — one-word publish for the VINDHYA Climate Portal.
#
# Usage:   ./push.sh              (uses a default commit message)
#          ./push.sh "your message here"
#
# Claude edits the files directly in this folder; this script commits and
# publishes them. GitHub Pages rebuilds within about two minutes.

cd "$(dirname "$0")" || exit 1

MSG=${1:-"Update portal"}

if git diff --quiet && git diff --staged --quiet && [ -z "$(git status --porcelain)" ]; then
  echo "Kuch badla nahi hai / Nothing to publish."
  exit 0
fi

echo "--- Badli hui files / Changed files ---"
git status --short

git add -A || exit 1
git commit -m "$MSG" || exit 1
git push || exit 1

echo ""
echo "PUBLISHED. Website 2 minute me update hogi:"
echo "https://vindhyaresearch25-a11y.github.io/vindhya-climate-portal/dashboard/"
