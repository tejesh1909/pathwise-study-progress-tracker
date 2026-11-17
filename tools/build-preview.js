/*
 * Builds preview/pathwise-preview.html — the whole frontend in ONE file, wired to an in-memory mock API
 * (tools/mock-api.js) instead of the server, so the UI can be explored without MongoDB or Node.
 *
 *   npm run preview   →   open preview/pathwise-preview.html in any browser
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

const scripts = [
  'shared/rules.js',
  'shared/features.js',
  'shared/seed-data.js',
  'tools/mock-api.js', // replaces client/js/api.js
  'client/js/ui.js',
  'client/js/charts.js',
  'client/js/views/forms.js',
  'client/js/views/extras.js',
  'client/js/views/dashboard.js',
  'client/js/views/goal.js',
  'client/js/views/misc.js',
  'client/js/views/landing.js',
  'client/js/views/share.js',
  'client/js/views/roadmap.js',
  'client/js/views/coach.js',
  'client/js/views/people.js',
  'client/js/views/approvals.js',
  'client/js/app.js',
];

const html = read('client/index.html')
  .replace('<link rel="stylesheet" href="/css/styles.css" />', `<style>\n${read('client/css/styles.css')}\n</style>`)
  .replace(/\s*<script src="\/js\/[^"]+"><\/script>/g, '')
  .replace('</body>', `${scripts.map((f) => `<script>/* ${f} */\n${safe(read(f))}\n</script>`).join('\n')}\n</body>`);

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
const out = path.join(root, 'preview', 'pathwise-preview.html');
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);

// A body-less fragment (title + fonts + style + app root + scripts) for hosts that wrap pages in their own skeleton.
const badgeCss = `.preview-badge{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:50;padding:7px 14px;border-radius:999px;font:600 12px var(--font);color:var(--text);background:color-mix(in srgb,var(--bg-2) 90%,transparent);border:1px solid var(--border-strong);box-shadow:var(--shadow);backdrop-filter:blur(10px);cursor:pointer;max-width:calc(100vw - 32px)}@media(max-width:860px){.preview-badge{bottom:84px}}`;
const fragment = `<title>Pathwise</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
<style>
${read('client/css/styles.css')}
${badgeCss}
</style>
<div id="app"></div>
<div class="preview-badge" id="pbadge" title="Click to dismiss">Interactive preview · sample data, resets on reload</div>
${scripts.map((f) => `<script>/* ${f} */\n${safe(read(f))}\n</script>`).join('\n')}
<script>document.getElementById('pbadge').addEventListener('click',function(){this.remove()});</script>
`;
fs.writeFileSync(path.join(root, 'preview', 'pathwise-artifact.html'), fragment);
console.log(`Wrote preview/pathwise-artifact.html (${(fragment.length / 1024).toFixed(0)} KB)`);
