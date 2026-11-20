import { AppError } from "@freebuff/shared";
import type { Ad } from "@freebuff/shared";

export const SPONSORED_LABEL = "Sponsored";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** The literal label is part of the ad schema; rendering refuses to guess. */
const requireLabel = (ad: Ad): Ad => {
  if (ad.label !== SPONSORED_LABEL) {
    throw new AppError({
      code: "validation_failed",
      message: "Sponsored inventory must carry the Sponsored label",
    });
  }
  return ad;
};

/** Plain-text rendering. "Sponsored" is always the first token. */
export const formatSponsoredAd = (ad: Ad): readonly string[] => {
  requireLabel(ad);
  return [
    `${SPONSORED_LABEL} · ${ad.headline}`,
    `${ad.body} ${ad.destinationUrl}`,
  ];
};

/**
 * HTML rendering for web surfaces. Text is escaped, the label is rendered as a
 * badge before the headline, and the link is marked `rel="sponsored"` so search
 * engines and users can identify it.
 */
export const sponsoredAdHtml = (ad: Ad): string => {
  requireLabel(ad);
  return [
    `<aside class="sponsored-ad" data-ad-id="${escapeHtml(String(ad.id))}" aria-label="${SPONSORED_LABEL}">`,
    `<span class="sponsored-label">${SPONSORED_LABEL}</span>`,
    `<strong>${escapeHtml(ad.headline)}</strong>`,
    `<p>${escapeHtml(ad.body)}</p>`,
    `<a href="${escapeHtml(ad.destinationUrl)}" rel="sponsored noopener noreferrer" target="_blank">${escapeHtml(ad.advertiser)}</a>`,
    `</aside>`,
  ].join("");
};

/** Single-line label used by terminals and native shells. */
export const sponsoredBadge = (ad: Ad): string => {
  requireLabel(ad);
  return `[${SPONSORED_LABEL}] ${ad.headline}`;
};
