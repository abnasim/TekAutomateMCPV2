const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs', 'requests');

function main() {
  if (!fs.existsSync(LOG_DIR)) {
    console.log('No logs directory.');
    return;
  }
  const files = fs
    .readdirSync(LOG_DIR)
    .map((name) => ({ name, time: fs.statSync(path.join(LOG_DIR, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  files.forEach(({ name }) => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(LOG_DIR, name), 'utf8'));
      const hasIssues =
        data.ok === false ||
        (data.postCheck && ((data.postCheck.errors || []).length || (data.postCheck.warnings || []).length));
      if (hasIssues) {
        console.log(`--- ${name} ---`);
        console.log(JSON.stringify(data, null, 2));
      }
    } catch {
      // ignore
    }
  });
}

main();
