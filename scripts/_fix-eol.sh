#!/usr/bin/env bash
set -euo pipefail
cd /home/peppa/code/molise-openworld
count=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  perl -pi -e 's/\r\n/\n/g' "$f"
  count=$((count + 1))
done < <(git ls-files --eol | grep 'i/lf.*w/crlf' | cut -f2)
echo "converted $count files to LF"
