#!/bin/sh
# Push the damzd/ subtree (branch export-main) to both GitHub repos.
# The token lives in /tmp/ghtoken (the credential helper reads it there, so
# it never appears on a command line) or, when the sandbox wiped /tmp, in a
# user-owned file at .deploy-token in the project root — the user stores
# their own credential there; nothing writes it programmatically.
set -e

cd /home/z/my-project

TOKEN_FILE=/tmp/ghtoken
if [ ! -s "$TOKEN_FILE" ] && [ -s .deploy-token ]; then
  TOKEN_FILE=.deploy-token
fi
if [ ! -s "$TOKEN_FILE" ]; then
  echo "no token at /tmp/ghtoken and no .deploy-token" >&2
  exit 1
fi

HELPER='!f(){ echo username=x-access-token; echo password=$(cat '"$TOKEN_FILE"'); }; f'

git -c "credential.helper=$HELPER" push -f origin export-main:main
git -c "credential.helper=$HELPER" push -f termux export-main:main

echo "---"
git ls-remote origin main
git ls-remote termux main
