#!/usr/bin/env python3
"""Regenerate the view-once fanout patch against the real installed file.

Reads the pristine file, applies the two edits (insert the DamzD comment,
drop view_once_unavailable_fanout from the skip list), then writes a proper
unified diff with node_modules-relative paths so patch-package accepts it.
"""
import subprocess
import sys

PKG = "node_modules/@whiskeysockets/baileys"
REL = "lib/Socket/messages-recv.js"
ORIG = "/tmp/messages-recv.orig.js"
TARGET = PKG + "/" + REL
OUT = "patches/@whiskeysockets+baileys+7.0.0-rc14.patch"

src = open(ORIG).read().splitlines(keepends=True)

needle = "unavailableType === 'view_once_unavailable_fanout'"
idx = [i for i, line in enumerate(src) if needle in line]
if len(idx) != 1:
    sys.exit("expected exactly one skip-list line, found " + str(len(idx)))
i = idx[0]
# The skip list is:
#   if (unavailableType === 'bot_unavailable_fanout' ||
#       unavailableType === 'hosted_unavailable_fanout' ||
#       unavailableType === 'view_once_unavailable_fanout') {
# Collapse the last two lines into one.
if "hosted_unavailable_fanout" not in src[i - 1]:
    sys.exit("unexpected skip-list shape around line " + str(i + 1))
src[i - 1] = src[i - 1].replace(
    "unavailableType === 'hosted_unavailable_fanout' ||",
    "unavailableType === 'hosted_unavailable_fanout') {"
)
del src[i]

comment = """\
                        // DamzD patch: stock skips view_once_unavailable_fanout
                        // here (matching WA Web's privacy filter), which left the
                        // companion blind to view-onces entirely — no upsert, no
                        // cache, no recovery. This bot's whole purpose is
                        // view-once recovery, so view-onces are NOT excluded:
                        // the placeholder resend is requested, the primary phone
                        // re-serves the full media, and the companion's normal
                        // message path (messages.upsert -> stash -> capture)
                        // fires. The phone still decides whether to comply
                        // (un-opened view-onces only), so view-once privacy is
                        // preserved at the source.
""".splitlines(keepends=True)

# Insert after the same index (now the collapsed condition line is at i-1,
# and the comment goes before the `if (...)` line which is now at i-1's next
# line — find the `if (unavailableType === 'bot_unavailable_fanout' ||` line.
j = [k for k, line in enumerate(src) if "if (unavailableType === 'bot_unavailable_fanout' ||" in line]
if len(j) != 1:
    sys.exit("expected one if-line, found " + str(len(j)))
src[j[0]:j[0]] = comment

open(TARGET, "w").write("".join(src))

diff = subprocess.run(
    ["diff", "-u", ORIG, TARGET],
    capture_output=True, text=True
).stdout.splitlines(keepends=True)

# Rewrite the ---/+++ header paths to node_modules-relative form.
header = [
    "diff --git a/" + TARGET + " b/" + TARGET + "\n",
    "--- a/" + TARGET + "\n",
    "+++ b/" + TARGET + "\n",
]
body = diff[2:]
open(OUT, "w").write("".join(header + body))
print("patch written:", OUT)
