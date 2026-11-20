import { AppError, webThemeCss } from "@freebuff/shared";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const BRAND_MARK = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M12 2.5 14.9 9l6.6 3-6.6 3L12 21.5 9.1 15 2.5 12l6.6-3L12 2.5Z" fill="currentColor" opacity=".92"/>
</svg>`;

/**
 * The sponsored footer is a sibling of the build log, never a child: it carries
 * the literal label and refuses markup that lost it.
 */
export const buildLogSponsorFooter = (adHtml: string): string => {
  if (!adHtml.includes('class="sponsored-label"') || !adHtml.includes(">Sponsored<")) {
    throw new AppError({
      code: "validation_failed",
      message: "Sponsored footer rendered without its literal label",
    });
  }
  return `<footer class="log-sponsor" data-slot="web.builder-ad" aria-label="Sponsored">${adHtml}</footer>`;
};

/**
 * Landing page + app builder. Everything is server-rendered here except the
 * build form, which talks to the existing JSON routes.
 */
export const builderHtml = (options: {
  readonly modelReady: boolean;
  readonly modelId?: string;
  readonly adHtml?: string;
}): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="description" content="Describe an app in one prompt. The builder writes it, gives it sign-in, a database and uploads, then publishes it." />
<title>freebuff · describe an app, ship it live</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2.5 14.9 9l6.6 3-6.6 3L12 21.5 9.1 15 2.5 12l6.6-3L12 2.5Z' fill='%237c8cff'/%3E%3C/svg%3E" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    color-scheme: dark;
    /* Shared token layer: packages/shared/src/theme (ANSI 256 + CSS vars). */
    ${webThemeCss()}
    --bg: var(--surface);
    --text: var(--text-primary);
    --muted: var(--text-muted);
    --faint: #6d778a;
    --border: rgba(255, 255, 255, 0.09);
    --border-strong: rgba(255, 255, 255, 0.18);
    --panel: linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.015));
    --accent-2: #22d3ee;
    --ok: var(--success);
    --radius: 18px;
    --font: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    min-height: 100vh;
    background: var(--bg);
    color: var(--text);
    font: 15px/1.6 var(--font);
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: -1;
    background:
      radial-gradient(900px 520px at 12% -8%, rgba(124, 140, 255, 0.22), transparent 65%),
      radial-gradient(760px 460px at 88% -4%, rgba(34, 211, 238, 0.14), transparent 62%),
      radial-gradient(900px 600px at 50% 110%, rgba(168, 85, 247, 0.12), transparent 70%);
    pointer-events: none;
  }
  .wrap { width: min(1120px, 100% - 44px); margin-inline: auto; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { color: #b8c1ff; }
  code { font-family: var(--mono); font-size: 0.92em; }

  /* ---------- header ---------- */
  .site-header {
    position: sticky; top: 0; z-index: 20;
    border-bottom: 1px solid var(--border);
    background: rgba(7, 9, 15, 0.72);
    backdrop-filter: blur(18px) saturate(140%);
  }
  .header-inner { display: flex; align-items: center; gap: 20px; height: 64px; }
  .brand { display: inline-flex; align-items: center; gap: 10px; color: var(--text); }
  .brand:hover { color: var(--text); }
  .brand-mark {
    display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px;
    color: #fff;
    background: linear-gradient(140deg, #7c8cff, #22d3ee 65%, #a855f7);
    box-shadow: 0 6px 18px rgba(124, 140, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
  .brand-mark svg { width: 18px; height: 18px; }
  .brand-name { font-weight: 650; letter-spacing: -0.02em; font-size: 16px; }
  .brand-tag {
    font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--muted); border: 1px solid var(--border); border-radius: 999px;
    padding: 2px 8px;
  }
  .nav-links { display: flex; align-items: center; gap: 4px; margin-left: 12px; }
  .nav-links a {
    color: var(--muted); font-size: 14px; padding: 7px 11px; border-radius: 9px;
    transition: color 0.15s ease, background 0.15s ease;
  }
  .nav-links a:hover { color: var(--text); background: rgba(255, 255, 255, 0.06); }
  .header-spacer { flex: 1; }
  .status-chip {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 12.5px; color: var(--muted);
    border: 1px solid var(--border); border-radius: 999px;
    padding: 6px 12px; background: rgba(255, 255, 255, 0.03);
    white-space: nowrap;
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok);
    box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.16); flex: none; }
  .dot.is-off { background: #f0b429; box-shadow: 0 0 0 3px rgba(240, 180, 41, 0.16); }

  /* ---------- hero ---------- */
  .hero { padding: clamp(52px, 8vw, 96px) 0 8px; text-align: center; }
  .eyebrow {
    display: inline-flex; align-items: center; gap: 9px;
    font-size: 12.5px; font-weight: 550; letter-spacing: 0.03em; color: #c3cbe4;
    border: 1px solid var(--border-strong); border-radius: 999px;
    padding: 6px 14px 6px 11px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }
  h1 {
    margin: 22px auto 18px;
    max-width: 15ch;
    font-size: clamp(38px, 6.4vw, 64px);
    line-height: 1.04;
    letter-spacing: -0.035em;
    font-weight: 660;
  }
  .grad {
    background: linear-gradient(105deg, #c7d2fe 5%, #7c8cff 42%, #22d3ee 88%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .lead {
    margin: 0 auto;
    max-width: 60ch;
    font-size: clamp(15.5px, 1.6vw, 17.5px);
    color: var(--muted);
  }

  /* ---------- composer ---------- */
  .composer {
    margin: 34px auto 0;
    max-width: 760px;
    text-align: left;
    border: 1px solid var(--border-strong);
    border-radius: 22px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02)), #0b0e17;
    box-shadow: 0 32px 80px -28px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.02),
      inset 0 1px 0 rgba(255, 255, 255, 0.07);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .composer:focus-within {
    border-color: rgba(124, 140, 255, 0.6);
    box-shadow: 0 32px 80px -28px rgba(0, 0, 0, 0.9), 0 0 0 4px rgba(124, 140, 255, 0.14);
  }
  textarea {
    display: block; width: 100%; min-height: 148px; resize: vertical;
    padding: 22px 22px 8px;
    color: inherit; background: transparent; border: 0; outline: none;
    font: 16px/1.6 var(--font);
  }
  textarea::placeholder { color: var(--faint); }
  .composer-foot {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding: 12px 14px 14px 22px;
  }
  .hint { font-size: 12.5px; color: var(--faint); }
  .hint kbd {
    font: 11px/1 var(--mono); color: var(--muted);
    border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 5px;
    padding: 3px 5px; margin-right: 4px; background: rgba(255, 255, 255, 0.04);
  }
  .spacer { flex: 1; }
  button {
    font: inherit; font-weight: 600; letter-spacing: -0.01em;
    display: inline-flex; align-items: center; gap: 9px;
    padding: 11px 20px; border: 0; border-radius: 12px; color: #080b14; cursor: pointer;
    background: linear-gradient(135deg, #aab4ff, #7c8cff 45%, #22d3ee);
    box-shadow: 0 10px 26px -10px rgba(124, 140, 255, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.5);
    transition: transform 0.15s ease, filter 0.15s ease, opacity 0.15s ease;
  }
  button:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
  button:active:not(:disabled) { transform: translateY(0); }
  button:disabled { cursor: progress; opacity: 0.6; }
  button .spinner {
    width: 14px; height: 14px; border-radius: 50%;
    border: 2px solid rgba(8, 11, 20, 0.35); border-top-color: #080b14;
    animation: spin 0.7s linear infinite; display: none;
  }
  button[aria-busy="true"] .spinner { display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .examples { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 18px auto 0; max-width: 820px; }
  .chip {
    font: 12.5px/1.2 var(--font); color: var(--muted); cursor: pointer;
    padding: 7px 12px; border-radius: 999px;
    border: 1px solid var(--border); background: rgba(255, 255, 255, 0.025);
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  }
  .chip:hover { color: var(--text); border-color: var(--border-strong); background: rgba(255, 255, 255, 0.06); }

  /* ---------- build status ---------- */
  #status:empty { display: none; }
  #status { max-width: 760px; margin: 22px auto 0; text-align: left; }
  .notice {
    display: flex; gap: 12px; align-items: flex-start;
    border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px;
    background: rgba(255, 255, 255, 0.03); font-size: 13.5px; color: var(--muted);
  }
  .notice.error { border-color: rgba(255, 122, 144, 0.35); background: rgba(255, 122, 144, 0.08); color: #ffd0d8; }
  .notice.ok { border-color: rgba(74, 222, 128, 0.32); background: rgba(74, 222, 128, 0.07); color: #c8f6d8; }
  .notice strong { color: var(--text); font-weight: 600; display: block; margin-bottom: 2px; }
  .notice.error strong, .notice.ok strong { color: inherit; }
  .timeline { list-style: none; margin: 0; padding: 0; }
  .timeline li {
    position: relative; display: flex; gap: 11px; padding: 7px 0 7px 0;
    font-size: 13.5px; color: var(--muted);
  }
  .timeline li::before {
    content: ""; width: 7px; height: 7px; margin-top: 7px; border-radius: 50%;
    background: var(--accent); box-shadow: 0 0 0 3px rgba(124, 140, 255, 0.15); flex: none;
  }
  .timeline li.is-done::before { background: var(--ok); box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.15); }
  .timeline li.is-failed::before { background: var(--danger); box-shadow: 0 0 0 3px rgba(255, 122, 144, 0.15); }
  .timeline .step { color: var(--text); font-weight: 550; }
  .timeline .detail { color: var(--faint); }

  /* ---------- studio: two-pane builder ---------- */
  .studio {
    display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    gap: 18px; align-items: stretch; margin-top: clamp(30px, 4vw, 42px);
  }
  .pane {
    display: flex; flex-direction: column; min-width: 0;
    border: 1px solid var(--border-strong); border-radius: 22px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.015)), #0b0e17;
    box-shadow: 0 32px 80px -34px rgba(0, 0, 0, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    padding: 18px;
  }
  .pane-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .pane-head h2 { margin: 0; font-size: 14.5px; font-weight: 620; letter-spacing: -0.01em; }
  .pane-state { font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; }
  .pane .composer { margin: 0; max-width: none; box-shadow: none; background: rgba(0, 0, 0, 0.28); }
  .pane .examples { justify-content: flex-start; margin: 14px 0 0; max-width: none; }
  .preview-frame {
    position: relative; flex: 1; min-height: 340px; display: grid;
    border: 1px solid var(--border); border-radius: 16px; overflow: hidden; background: #05070c;
  }
  .preview-frame iframe { width: 100%; height: 100%; min-height: 340px; border: 0; background: #fff; }
  .preview-frame iframe[hidden] { display: none; }
  .preview-empty { margin: auto; padding: 26px; text-align: center; color: var(--faint); font-size: 13.5px; max-width: 34ch; }
  .preview-empty[hidden] { display: none; }
  .pane-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .pane-actions[hidden] { display: none; }
  .pane-actions .ghost-link { background: transparent; cursor: pointer; font: 12.5px/1.2 var(--font); }
  .eject { margin-top: 12px; display: grid; gap: 8px; border-top: 1px solid var(--border); padding-top: 12px; }
  .eject[hidden] { display: none; }
  .eject label { font-size: 12px; color: var(--muted); }
  .eject input {
    width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border-strong);
    background: rgba(0, 0, 0, 0.35); color: var(--text); font: 13px/1.4 var(--mono);
  }
  .eject input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .eject-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
  .eject-row button { padding: 10px 16px; }
  .eject-row .chip { padding: 10px 16px; border-radius: 12px; }

  /* ---------- build log ---------- */
  .log-region { margin-top: 18px; }
  .log { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .log-row {
    display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline;
    padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px;
    background: rgba(255, 255, 255, 0.025); font-size: 13px;
  }
  .log-row[data-state="done"] .log-mark { color: var(--ok); }
  .log-row[data-state="failed"] { border-color: rgba(255, 122, 144, 0.35); background: rgba(255, 122, 144, 0.07); }
  .log-row[data-state="failed"] .log-mark { color: var(--danger); }
  .log-mark { font-family: var(--mono); }
  .log-name { font: 600 12.5px/1.2 var(--mono); color: var(--text); }
  .log-detail { color: var(--faint); overflow-wrap: anywhere; }
  .log-empty { margin: 0; color: var(--faint); font-size: 13px; }
  .log-empty[hidden] { display: none; }
  .log-sponsor { margin-top: 14px; }
  .log-sponsor .sponsored-ad { padding: 14px 16px; }
  .log-sponsor .sponsored-ad strong { font-size: 13.5px; }
  .log-sponsor .sponsored-ad p { margin: 4px 0 6px; }

  /* ---------- content grid ---------- */
  .grid {
    display: grid; grid-template-columns: minmax(0, 1.72fr) minmax(280px, 1fr);
    gap: 18px; align-items: start;
    padding: clamp(38px, 6vw, 68px) 0 0;
  }
  .panel {
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--panel);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 24px 60px -40px rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(12px);
    padding: 22px;
  }
  .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
  .panel-head h2 { margin: 0; font-size: 15.5px; font-weight: 620; letter-spacing: -0.015em; }
  .panel-head .count { font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; }
  .panel-sub { margin: 0 0 16px; font-size: 13px; color: var(--faint); }

  .apps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .app-card {
    display: flex; align-items: center; gap: 14px;
    border: 1px solid var(--border); border-radius: 14px;
    padding: 14px 16px; background: rgba(255, 255, 255, 0.02);
    transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
  }
  .app-card:hover { border-color: rgba(124, 140, 255, 0.4); background: rgba(124, 140, 255, 0.06); transform: translateY(-1px); }
  .app-avatar {
    display: grid; place-items: center; flex: none;
    width: 38px; height: 38px; border-radius: 11px;
    font-weight: 650; font-size: 15px; color: #0a0d16;
    background: linear-gradient(140deg, #aab4ff, #22d3ee);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
  }
  .app-body { min-width: 0; flex: 1; }
  .app-name { display: block; font-weight: 570; color: var(--text); font-size: 14.5px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .app-name:hover { color: #b8c1ff; }
  .app-meta { margin: 2px 0 0; font-size: 12.5px; color: var(--faint);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .app-actions { display: flex; align-items: center; gap: 8px; flex: none; }
  .badge {
    font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    color: #b7f7c9; background: rgba(74, 222, 128, 0.12);
    border: 1px solid rgba(74, 222, 128, 0.28); border-radius: 999px; padding: 3px 8px;
  }
  .badge.is-muted { color: var(--muted); background: rgba(255, 255, 255, 0.05); border-color: var(--border); }
  .ghost-link {
    font-size: 12.5px; color: var(--muted); padding: 6px 10px; border-radius: 9px;
    border: 1px solid var(--border); white-space: nowrap;
  }
  .ghost-link:hover { color: var(--text); border-color: var(--border-strong); background: rgba(255, 255, 255, 0.05); }
  .empty { padding: 26px 8px; text-align: center; color: var(--faint); font-size: 13.5px;
    border: 1px dashed var(--border); border-radius: 14px; }
  .skeleton { height: 66px; border-radius: 14px; border: 1px solid var(--border);
    background: linear-gradient(90deg, rgba(255,255,255,.03), rgba(255,255,255,.07), rgba(255,255,255,.03));
    background-size: 200% 100%; animation: shimmer 1.4s ease-in-out infinite; }
  @keyframes shimmer { to { background-position: -200% 0; } }

  /* ---------- aside ---------- */
  .aside-stack { display: grid; gap: 14px; }
  .stat { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 10px 0; border-top: 1px solid var(--border); font-size: 13px; }
  .stat:first-of-type { border-top: 0; }
  .stat dt { color: var(--faint); margin: 0; }
  .stat dd { margin: 0; color: var(--text); font-weight: 550; text-align: right;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%; }
  .stat dd code { color: #c6ceff; font-size: 12px; }
  .callout {
    border: 1px solid rgba(240, 180, 41, 0.3); background: rgba(240, 180, 41, 0.08);
    color: #ffe6b8; border-radius: 12px; padding: 12px 14px; font-size: 12.5px; line-height: 1.5;
  }
  .callout code { color: #ffe6b8; }

  /* sponsored slot (kept on-brand but clearly labelled) */
  .sponsored-ad {
    position: relative; overflow: hidden;
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 18px;
    background: linear-gradient(160deg, rgba(34, 211, 238, 0.1), rgba(124, 140, 255, 0.06) 55%, rgba(255, 255, 255, 0.02));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
  }
  .sponsored-ad .sponsored-label {
    display: inline-block; font-size: 10px; font-weight: 650; letter-spacing: 0.1em;
    text-transform: uppercase; color: #bfe9f5;
    border: 1px solid rgba(34, 211, 238, 0.35); border-radius: 999px;
    padding: 2px 8px; margin-bottom: 10px; background: rgba(34, 211, 238, 0.1);
  }
  .sponsored-ad strong { display: block; font-size: 14.5px; font-weight: 600; color: var(--text); }
  .sponsored-ad p { margin: 5px 0 10px; font-size: 12.8px; color: var(--muted); line-height: 1.55; }
  .sponsored-ad a { font-size: 12.5px; font-weight: 600; color: #7fe6f7; }
  .sponsored-ad a::after { content: " ↗"; }

  /* ---------- footer ---------- */
  .site-footer { margin-top: clamp(48px, 7vw, 84px); border-top: 1px solid var(--border); }
  .footer-inner {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    flex-wrap: wrap; padding: 26px 0 34px; font-size: 12.5px; color: var(--faint);
  }
  .footer-inner .brand-name { font-size: 13px; color: var(--muted); }
  .footer-links { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .footer-links a { color: var(--faint); }
  .footer-links a:hover { color: var(--text); }

  /* ---------- responsive ---------- */
  @media (max-width: 940px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 760px) {
    .nav-links { display: none; }
  }
  @media (max-width: 620px) {
    .wrap { width: min(1120px, 100% - 32px); }
    .brand-tag, .header-spacer ~ .status-chip span.label { display: none; }
    .hero { padding-top: 44px; }
    textarea { min-height: 130px; padding: 18px 18px 6px; }
    .composer-foot { padding: 10px 12px 12px 16px; }
    .composer-foot button { width: 100%; justify-content: center; }
    .hint { display: none; }
    .app-card { flex-wrap: wrap; }
    .app-actions { width: 100%; justify-content: space-between; }
    .examples { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
  }
</style>
</head>
<body>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="freebuff home">
      <span class="brand-mark">${BRAND_MARK}</span>
      <span class="brand-name">freebuff</span>
      <span class="brand-tag">builder</span>
    </a>
    <nav class="nav-links" aria-label="Sections">
      <a href="#builder">Builder</a>
      <a href="#apps">Published apps</a>
      <a href="#workspace">Workspace</a>
    </nav>
    <span class="header-spacer"></span>
    <span class="status-chip" title="${options.modelReady ? "A model provider is configured" : "No model provider is configured"}">
      <span class="dot${options.modelReady ? "" : " is-off"}"></span>
      <span class="label">${options.modelReady ? "Builder online" : "Model not configured"}</span>
    </span>
  </div>
</header>

<main class="wrap">
  <section class="hero" id="builder">
    <span class="eyebrow"><span class="dot"></span> AI app builder</span>
    <h1>Describe an app.<br /><span class="grad">Ship it live.</span></h1>
    <p class="lead">One prompt. The builder writes a working app with sign-in, a real database and file uploads, then publishes it for you.</p>
  </section>

  <div class="studio">
    <section class="pane" aria-labelledby="prompt-title">
      <div class="pane-head">
        <h2 id="prompt-title">Describe the app</h2>
        <span class="pane-state">one prompt · deploys live</span>
      </div>
      <form class="composer" id="build">
        <label for="prompt" class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Describe the app you want</label>
        <textarea id="prompt" name="prompt" placeholder="A recipe box where I can save recipes with a title, ingredients, steps and a photo, and mark favourites." spellcheck="false"></textarea>
        <div class="composer-foot">
          <span class="hint"><kbd>Ctrl</kbd><kbd>↵</kbd> · one hour is charged when you deploy</span>
          <span class="spacer"></span>
          <button id="submit" type="submit"><span class="spinner" aria-hidden="true"></span><span id="submit-label">Deploy app</span></button>
        </div>
      </form>
      <div class="examples" aria-label="Example prompts">
        <button class="chip" type="button" data-prompt="A recipe box where I can save recipes with a title, ingredients, steps and a photo, and mark favourites.">Recipe box</button>
        <button class="chip" type="button" data-prompt="A freelance invoice tracker with clients, invoices, line items, paid/unpaid status and a monthly revenue summary.">Invoice tracker</button>
        <button class="chip" type="button" data-prompt="A habit tracker where I check off daily habits, keep a streak and see a weekly heatmap.">Habit tracker</button>
        <button class="chip" type="button" data-prompt="A small event RSVP app with events, guest lists and a photo upload for each event.">Event RSVPs</button>
      </div>
    </section>

    <section class="pane" aria-labelledby="preview-title">
      <div class="pane-head">
        <h2 id="preview-title">Preview</h2>
        <span class="pane-state" id="preview-state">waiting for a deploy</span>
      </div>
      <div class="preview-frame">
        <p class="preview-empty" id="preview-empty">Your app appears here as soon as the build deploys.</p>
        <iframe id="preview" title="Live preview of the generated app" hidden sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
      </div>
      <div class="pane-actions" id="app-actions" hidden>
        <a class="ghost-link" id="open-app" href="#" target="_blank" rel="noopener noreferrer">Open app</a>
        <a class="ghost-link" id="download-source" href="#">Download source</a>
        <button class="ghost-link" type="button" id="eject-toggle" aria-expanded="false" aria-controls="eject-form">Eject → GitHub</button>
      </div>
      <form class="eject" id="eject-form" hidden>
        <p class="hint">Creates a private repository and pushes the generated source. The token is used for this request only and is never stored.</p>
        <label for="eject-name">Repository name</label>
        <input id="eject-name" name="name" type="text" placeholder="my-app" autocomplete="off" />
        <label for="eject-token">GitHub token</label>
        <input id="eject-token" name="token" type="password" placeholder="ghp_…" autocomplete="off" />
        <div class="eject-row">
          <button type="submit" id="eject-submit">Eject to GitHub</button>
          <button type="button" class="chip" id="eject-cancel">Cancel</button>
        </div>
        <p class="hint" id="eject-status" role="status" aria-live="polite"></p>
      </form>
    </section>
  </div>

  <section class="panel log-region" aria-labelledby="log-title">
    <div class="panel-head">
      <h2 id="log-title">Build log</h2>
      <span class="count" id="log-state">idle</span>
    </div>
    <p class="panel-sub">Named steps stream in as the build runs: spec → scaffolded → schema → auth → deployed.</p>
    <ol class="log" id="build-log" data-slot="build-log"></ol>
    <p class="log-empty" id="log-empty">Nothing built yet. Describe an app and press Deploy.</p>
    ${options.adHtml === undefined ? "" : buildLogSponsorFooter(options.adHtml)}
  </section>

  <div class="grid">
    <section class="panel" id="apps" aria-labelledby="apps-title">
      <div class="panel-head">
        <h2 id="apps-title">Published apps</h2>
        <span class="count" id="apps-count"></span>
      </div>
      <p class="panel-sub">Apps built from this workspace. Open one, or take the source with you.</p>
      <ul class="apps" id="apps-list">
        <li class="skeleton"></li>
        <li class="skeleton"></li>
      </ul>
    </section>

    <aside class="aside-stack" id="workspace" aria-label="Workspace details">
      <div class="panel">
        <div class="panel-head"><h2>Workspace</h2></div>
        <dl style="margin:0">
          <div class="stat"><dt>Model</dt><dd>${options.modelReady ? `<code>${escapeHtml(options.modelId ?? "")}</code>` : "Not configured"}</dd></div>
          <div class="stat"><dt>Hosting</dt><dd>Local adapter</dd></div>
          <div class="stat"><dt>Auth</dt><dd>Magic link + phone</dd></div>
        </dl>
        ${options.modelReady ? "" : `<div class="callout" style="margin-top:12px">No model provider is configured. Set <code>DEEPSEEK_API_KEY</code>, <code>OPENAI_API_KEY</code> or <code>ANTHROPIC_API_KEY</code> on the server.</div>`}
      </div>
    </aside>
  </div>
</main>

<footer class="site-footer">
  <div class="wrap footer-inner">
    <span><span class="brand-name">freebuff</span> · apps from a sentence</span>
    <span class="footer-links">
      <a href="#builder">Build an app</a>
      <a href="#apps">Your apps</a>
      <a href="/api/quota">Quota API</a>
      <a href="/api/ads?slot=web.builder">Ads API</a>
    </span>
  </div>
</footer>

<script>
(function () {
  var form = document.getElementById('build');
  var prompt = document.getElementById('prompt');
  var submit = document.getElementById('submit');
  var submitLabel = document.getElementById('submit-label');
  var list = document.getElementById('apps-list');
  var count = document.getElementById('apps-count');
  var log = document.getElementById('build-log');
  var logEmpty = document.getElementById('log-empty');
  var logState = document.getElementById('log-state');
  var previewFrame = document.getElementById('preview');
  var previewEmpty = document.getElementById('preview-empty');
  var previewState = document.getElementById('preview-state');
  var actions = document.getElementById('app-actions');
  var openApp = document.getElementById('open-app');
  var downloadSource = document.getElementById('download-source');
  var ejectToggle = document.getElementById('eject-toggle');
  var ejectForm = document.getElementById('eject-form');
  var ejectStatus = document.getElementById('eject-status');
  var currentApp = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\\s+/);
    var first = parts[0] ? parts[0].charAt(0) : '?';
    var second = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + second).toUpperCase();
  }

  function emptyState(text) {
    list.textContent = '';
    list.appendChild(el('li', 'empty', text));
  }

  function renderApps(apps) {
    list.textContent = '';
    count.textContent = apps.length === 1 ? '1 app' : apps.length + ' apps';
    if (apps.length === 0) {
      emptyState('No apps yet — describe one above and it will appear here.');
      return;
    }
    apps.forEach(function (app) {
      var item = el('li', 'app-card');
      item.appendChild(el('span', 'app-avatar', initials(app.spec.name)));

      var body = el('div', 'app-body');
      var name = el('a', 'app-name', app.spec.name);
      name.href = app.url;
      body.appendChild(name);
      body.appendChild(el('p', 'app-meta', (app.spec.tagline || '') + ' · ' + new Date(app.createdAt).toLocaleDateString()));
      item.appendChild(body);

      var row = el('div', 'app-actions');
      row.appendChild(el('span', app.status === 'deployed' ? 'badge' : 'badge is-muted', app.status));
      var source = el('a', 'ghost-link', 'Source');
      source.href = '/api/apps/' + app.id + '/eject';
      source.title = 'Download the generated source';
      row.appendChild(source);
      item.appendChild(row);

      list.appendChild(item);
    });
  }

  function loadApps() {
    fetch('/api/apps').then(function (response) {
      if (response.status === 401) return { apps: null };
      return response.json();
    }).then(function (body) {
      if (body.apps === null) {
        count.textContent = '';
        emptyState('Sign in to see your apps. Public apps stay reachable through their links.');
        return;
      }
      renderApps(body.apps || []);
    }).catch(function () {
      count.textContent = '';
      emptyState('Could not load apps right now.');
    });
  }

  function setBusy(busy) {
    submit.disabled = busy;
    submit.setAttribute('aria-busy', busy ? 'true' : 'false');
    submitLabel.textContent = busy ? 'Deploying…' : 'Deploy app';
  }

  function clearLog() {
    log.textContent = '';
    if (logEmpty) logEmpty.hidden = true;
    logState.textContent = 'running';
  }

  function logRow(step, detail, state) {
    var row = el('li', 'log-row');
    row.setAttribute('data-step', step);
    row.setAttribute('data-state', state);
    row.appendChild(el('span', 'log-mark', state === 'failed' ? '✗' : '✓'));
    row.appendChild(el('span', 'log-name', step));
    if (detail) row.appendChild(el('span', 'log-detail', detail));
    log.appendChild(row);
    return row;
  }

  function appendStep(step) {
    var value = String(step.status || '').toLowerCase();
    var state = value === 'failed' || value === 'error' ? 'failed' : 'done';
    return logRow(step.step, step.detail || '', state);
  }

  function appendError(message) {
    logRow('error', message, 'failed');
    logState.textContent = 'failed';
  }

  function showApp(app, url) {
    currentApp = app;
    previewFrame.src = url;
    previewFrame.hidden = false;
    if (previewEmpty) previewEmpty.hidden = true;
    previewState.textContent = 'deployed';
    openApp.href = url;
    downloadSource.href = '/api/apps/' + app.id + '/eject';
    actions.hidden = false;
    logState.textContent = 'deployed';
    loadApps();
  }

  function handleEvent(event) {
    if (event.type === 'step') { appendStep(event); return; }
    if (event.type === 'done') { showApp(event.app, event.url); return; }
    if (event.type === 'error') { appendError(event.message || 'Build failed'); }
  }

  function readEvents(response) {
    if (!response.body || !response.body.getReader) {
      return response.json().then(function (body) {
        appendError(body.message || 'Build failed');
      });
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) {
          if (buffer.trim()) {
            try { handleEvent(JSON.parse(buffer)); } catch (ignored) {}
          }
          return;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\\n');
        buffer = lines.pop() || '';
        lines.forEach(function (line) {
          if (!line.trim()) return;
          try { handleEvent(JSON.parse(line)); } catch (ignored) {}
        });
        return pump();
      });
    }
    return pump();
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!prompt.value.trim() || submit.disabled) return;
    setBusy(true);
    clearLog();
    previewState.textContent = 'building';
    fetch('/api/apps/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.value })
    }).then(function (response) {
      if (!response.ok) {
        return response.json().then(function (body) {
          throw new Error(body.message || 'Build failed');
        });
      }
      return readEvents(response);
    }).catch(function (error) {
      appendError(error.message || 'Build failed');
      previewState.textContent = 'failed';
    }).finally(function () { setBusy(false); });
  });

  prompt.addEventListener('keydown', function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll('.chip[data-prompt]'), function (chip) {
    chip.addEventListener('click', function () {
      prompt.value = chip.getAttribute('data-prompt') || '';
      prompt.focus();
    });
  });

  if (ejectToggle && ejectForm) {
    ejectToggle.addEventListener('click', function () {
      var opening = ejectForm.hidden;
      ejectForm.hidden = !opening;
      ejectToggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
    });
  }

  var ejectCancel = document.getElementById('eject-cancel');
  if (ejectCancel && ejectForm && ejectToggle) {
    ejectCancel.addEventListener('click', function () {
      ejectForm.hidden = true;
      ejectToggle.setAttribute('aria-expanded', 'false');
    });
  }

  if (ejectForm) {
    ejectForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!currentApp) {
        if (ejectStatus) ejectStatus.textContent = 'Deploy an app first.';
        return;
      }
      var token = document.getElementById('eject-token');
      var name = document.getElementById('eject-name');
      if (ejectStatus) ejectStatus.textContent = 'Pushing to GitHub…';
      fetch('/api/apps/' + currentApp.id + '/eject/github', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: token ? token.value : '',
          name: name && name.value.trim() ? name.value.trim() : undefined
        })
      }).then(function (response) {
        return response.json().then(function (body) { return { ok: response.ok, body: body }; });
      }).then(function (result) {
        if (!result.ok) {
          if (ejectStatus) ejectStatus.textContent = result.body.message || 'Eject failed.';
          return;
        }
        if (ejectStatus) ejectStatus.textContent = 'Pushed to ' + result.body.url;
      }).catch(function () {
        if (ejectStatus) ejectStatus.textContent = 'Network error. Try again.';
      });
    });
  }

  loadApps();
})();
</script>
</script>
</body>
</html>`;
