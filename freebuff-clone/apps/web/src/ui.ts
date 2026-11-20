const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const builderHtml = (options: {
  readonly modelReady: boolean;
  readonly modelId?: string;
  readonly adHtml?: string;
}): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>freebuff app builder</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d1117; color: #e6edf3; font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 820px; margin: 0 auto; padding: 48px 24px 72px; }
  h1 { margin: 0 0 6px; font-size: 28px; }
  .muted { color: #9da7b3; }
  textarea { width: 100%; min-height: 120px; margin: 18px 0 12px; padding: 12px;
    color: inherit; background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    font: inherit; resize: vertical; }
  button { font: inherit; font-weight: 600; padding: 10px 18px; border: 0; border-radius: 8px;
    background: #2f81f7; color: #fff; cursor: pointer; }
  button:disabled { opacity: .55; cursor: progress; }
  section { margin-top: 28px; border: 1px solid #30363d; border-radius: 10px; padding: 18px; background: #10151c; }
  ul { list-style: none; padding: 0; margin: 10px 0 0; display: grid; gap: 8px; }
  li { border: 1px solid #21262d; border-radius: 8px; padding: 10px 12px; }
  a { color: #58a6ff; }
  .error { color: #f85149; }
  .ok { color: #3fb950; }
  .sponsored-ad { margin-top: 22px; border: 1px dashed #30363d; border-radius: 10px; padding: 14px 16px; background: #0f141a; }
  .sponsored-ad .sponsored-label { display: inline-block; font-size: 11px; letter-spacing: .08em;
    text-transform: uppercase; color: #9da7b3; border: 1px solid #30363d; border-radius: 999px;
    padding: 1px 8px; margin-bottom: 8px; }
  .sponsored-ad strong { display: block; }
  .sponsored-ad p { margin: 4px 0; color: #9da7b3; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body>
<main>
  <h1>Describe an app</h1>
  <p class="muted">One prompt. The builder writes a working app with sign-in, a real database and file uploads, then publishes it.</p>
  ${options.modelReady ? `<p class="muted">Model: <code>${escapeHtml(options.modelId ?? "")}</code></p>` : `<p class="error">No model provider is configured. Set DEEPSEEK_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY on the server.</p>`}
  ${options.adHtml ?? ""}
  <form id="build">
    <textarea id="prompt" placeholder="A recipe box where I can save recipes with a title, ingredients, steps and a photo, and mark favourites."></textarea>
    <button id="submit" type="submit">Build app</button>
  </form>
  <div id="status"></div>
  <section>
    <strong>Published apps</strong>
    <ul id="apps"><li class="muted">Loading…</li></ul>
  </section>
</main>
<script>
(function () {
  var form = document.getElementById('build');
  var prompt = document.getElementById('prompt');
  var submit = document.getElementById('submit');
  var status = document.getElementById('status');
  var apps = document.getElementById('apps');

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function loadApps() {
    fetch('/api/apps').then(function (r) {
      if (r.status === 401) return { apps: null };
      return r.json();
    }).then(function (body) {
      if (body.apps === null) {
        apps.textContent = 'Sign in to see your apps.';
        return;
      }
      apps.textContent = '';
      if (!body.apps || body.apps.length === 0) {
        apps.appendChild(el('li', 'muted', 'No apps yet.'));
        return;
      }
      body.apps.forEach(function (app) {
        var item = el('li');
        var link = el('a', '', app.spec.name);
        link.href = app.url;
        item.appendChild(link);
        item.appendChild(el('div', 'muted', app.spec.tagline + ' · ' + app.status));
        var actions = el('div');
        var eject = el('a', '', 'Download source');
        eject.href = '/api/apps/' + app.id + '/eject';
        actions.appendChild(eject);
        item.appendChild(actions);
        apps.appendChild(item);
      });
    }).catch(function () { apps.textContent = 'Could not load apps.'; });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = '';
    status.appendChild(el('p', 'muted', 'Designing, scaffolding and deploying…'));
    fetch('/api/apps', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.value })
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) throw new Error(body.message || 'Build failed');
        return body;
      });
    }).then(function (body) {
      status.textContent = '';
      var heading = el('p', 'ok', 'Deployed.');
      status.appendChild(heading);
      var list = el('ul');
      body.timeline.forEach(function (step) {
        list.appendChild(el('li', '', step.step + ': ' + step.status + (step.detail ? ' — ' + step.detail : '')));
      });
      status.appendChild(list);
      var link = el('a', '', 'Open ' + body.app.spec.name);
      link.href = body.url;
      status.appendChild(link);
      prompt.value = '';
      loadApps();
    }).catch(function (error) {
      status.textContent = '';
      status.appendChild(el('p', 'error', error.message));
    }).finally(function () { submit.disabled = false; });
  });

  loadApps();
})();
</script>
</body>
</html>`;
