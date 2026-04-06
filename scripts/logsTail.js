const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs', 'requests');

function printLatest(count = 5) {
  if (!fs.existsSync(LOG_DIR)) return;
  const files = fs
    .readdirSync(LOG_DIR)
    .map((name) => ({ name, time: fs.statSync(path.join(LOG_DIR, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
    .slice(0, count);
  files.reverse().forEach((f) => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(LOG_DIR, f.name), 'utf8'));
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`Failed to read ${f.name}: ${err}`);
    }
  });
}

function watch() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  console.log(`Watching ${LOG_DIR} ...`);
  printLatest(3);
  fs.watch(LOG_DIR, (event, filename) => {
    if (!filename) return;
    const full = path.join(LOG_DIR, filename);
    setTimeout(() => {
      if (fs.existsSync(full)) {
        try {
          const data = JSON.parse(fs.readFileSync(full, 'utf8'));
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          // ignore
        }
      }
    }, 200);
  });
}

watch();
