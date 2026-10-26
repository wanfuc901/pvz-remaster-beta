#!/usr/bin/env bash
# Build here, ship only the runtime files to the VPS, reinstall production deps there and restart.
# The VPS never builds: the client build needs ~750 MB RAM and the VM has 1 GB shared with other services.
# Works from Git Bash, WSL or Linux:  tv-webos/deploy/deploy-vps.sh
set -euo pipefail

HOST=${TVWEBOS_HOST:-ubuntu@129.221.211.24}
KEY=${TVWEBOS_KEY:-$HOME/.ssh/oracle_ssh_key}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

cd "$ROOT"
npm ci --no-audit --no-fund
npm run build
npm test

# The tarball streams over SSH stdin, so the remote steps travel as the command argument.
REMOTE='set -euo pipefail
STAGE=$(mktemp -d)
trap "rm -rf \"$STAGE\"" EXIT
tar --no-same-owner -xf - -C "$STAGE"
rsync -rt --delete --exclude=/node_modules/ "$STAGE"/ /opt/tv-webos/
cd /opt/tv-webos
nice -n 10 npm ci --omit=dev --no-audit --no-fund --loglevel=error
chmod -R u+rwX,g+rX,g-w,o-rwx /opt/tv-webos
sudo systemctl restart tv-webos
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -fs http://127.0.0.1:8686/api/health && echo && exit 0; sleep 1; done
sudo journalctl -u tv-webos -n 30 --no-pager
exit 1'

tar --exclude='*.test.*' -cf - \
  package.json package-lock.json \
  shared/package.json shared/dist \
  server/package.json server/dist server/catalog \
  client/dist \
  | ssh -i "$KEY" -o BatchMode=yes "$HOST" "$REMOTE"
