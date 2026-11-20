# @freebuff/ads (Phase 5)

Sponsored text inventory for every surface: slot-based selection, impression and
click accounting on the server, and renderers that cannot drop the "Sponsored"
label.

Status: implemented. Phase 2 delivered ordered selection and plain-text
rendering; Phase 5 adds the cross-surface inventory, the accounting engine and
HTML/terminal renderers.

## Inventory

`config/inventory.json` is configuration, parsed through `adSchema` at import
time. Every ad carries:

- `label: "Sponsored"` — a literal, not a free string.
- An HTTPS `destinationUrl`.
- `slots` from the shared `adSlotSchema` (`cli.session`, `cli.startup`,
  `desktop.sidebar`, `web.builder`, `cloud.dashboard`).
- `topics` for contextual matching and a `weight` for weighted selection.

## Selection

`selectSponsoredAd({ slot, plan, topics, seed }, inventory)`:

- Returns `undefined` for the paid tier — paid accounts never see ads.
- Filters to active inventory serving the requested slot.
- Prefers ads whose topics match the locally derived topic labels, otherwise
  falls back to the whole slot pool.
- Seeds a deterministic PRNG with the session id, so a session is stable and
  tests are reproducible.

Topics are labels derived from a local embedding of the prompt. Prompt text,
code and identifiers never leave the client for ad selection, and an impression
records only `adId`, `slot`, `surface`, `sessionId` and `shownAt`.

## Accounting

`AdEngine.serve()` records one impression per decision. `AdEngine.click(ad, …)`
records a click for a previously served ad. `stats(ads)` reports impressions and
clicks per ad, and `slotsCovered()` lists the slots the active inventory fills.

`AdEventStore` is the persistence boundary: `InMemoryAdEventStore` for tests and
`SqliteAdEventStore` (in `apps/web`) for the platform.

## Rendering

| Export | Surface |
| --- | --- |
| `formatSponsoredAd(ad)` | Plain text, label as the first token |
| `sponsoredBadge(ad)` | One-line terminal/native badge |
| `sponsoredAdHtml(ad)` | Escaped HTML with a label badge and `rel="sponsored noopener noreferrer"` |

All three call `requireLabel` and throw `validation_failed` if inventory ever
loses the literal label, so a mislabelled ad fails closed instead of rendering.

## Tests

`tests/unit/ads/select.test.ts` and `tests/unit/ads/engine.test.ts` cover slot
coverage, contextual and fallback selection, paid exclusion, impression and
click counts, impression shape, escaping and label enforcement.
