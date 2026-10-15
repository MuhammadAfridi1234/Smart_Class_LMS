const fs = require('node:fs');
fs.mkdirSync('public/vendor', { recursive: true });
fs.copyFileSync('node_modules/chart.js/dist/chart.umd.js', 'public/vendor/chart.js');
