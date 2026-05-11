#!/bin/bash
set -euo pipefail

cd /home/node

# Start Firestore + Auth emulators in background
firebase emulators:start --only firestore,auth --project bks-dev &
EMULATOR_PID=$!

echo "Waiting for emulators..."
node -e "
const net = require('net');
function waitForPort(port, host) {
  return new Promise((resolve) => {
    const retry = () => {
      const sock = net.createConnection(port, host);
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => { sock.destroy(); setTimeout(retry, 1000); });
    };
    retry();
  });
}
Promise.all([
  waitForPort(8080, 'localhost').then(() => console.log('Firestore emulator ready')),
  waitForPort(9099, 'localhost').then(() => console.log('Auth emulator ready')),
]).then(() => process.exit(0));
"

echo "Seeding data..."
node /home/node/seed.js && echo "Seed complete." || echo "Seed failed (emulator still running)"

wait $EMULATOR_PID
