#!/bin/sh
# Build the export-main branch: the damzd/ bot subtree, re-rooted at the top
# level, exactly the tree GitHub serves. Uses a temp index (no git subtree
# needed): copies every TRACKED file under damzd/ into /tmp/export-tree,
# writes a tree, and commits it on top of the current export-main tip.
set -e
cd /home/z/my-project

PARENT=$(git rev-parse export-main)
echo "export parent: $PARENT"

rm -rf /tmp/export-tree /tmp/export-index
mkdir -p /tmp/export-tree
(cd damzd && git ls-files -z | xargs -0 cp --parents --target-directory=/tmp/export-tree)

GIT_INDEX_FILE=/tmp/export-index git read-tree --empty
GIT_INDEX_FILE=/tmp/export-index git --work-tree=/tmp/export-tree add -A .
TREE=$(GIT_INDEX_FILE=/tmp/export-index git write-tree)
echo "tree: $TREE"

# The export commit carries the CURRENT damzd release message — Render shows
# it on the deploy card, so a stale hardcoded string here made every deploy
# since v1.4.31 display the wrong release notes.
SUBJECT=$(git log -1 --format=%s -- damzd)
BODY=$(git log -1 --format=%b -- damzd)
COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "$SUBJECT

$BODY")
git update-ref refs/heads/export-main "$COMMIT"
echo "export-main -> $COMMIT"
