# @freebuff/quota (Phase 5)

Server-authoritative hour quota: country configuration, plan entitlements,
active-hour tracking, local-midnight reset with no rollover and the
verification gate for the free tier.

Status: implemented. Phase 2 delivered the evaluator and service; Phase 5 adds
the full country matrix, structural validation and one place that decides what a
plan unlocks.

## Configuration

`config/quota.json` holds the policy. No allowance is hardcoded in a runtime
path, and a country that is not listed falls back to `default`.

```json
{
  "version": 1,
  "default": { "timeZone": "UTC", "freeHoursPerDay": 5, "paidHoursPerDay": 40 },
  "countries": [
    {
      "countryCode": "US",
      "timeZone": "America/New_York",
      "freeHoursPerDay": 30,
      "paidHoursPerDay": 60,
      "updatedAt": "2026-11-19T00:00:00.000Z"
    }
  ]
}
```

The flagship US matrix is 25 countries; every entry names an IANA zone so the
daily reset happens at the user's local midnight.

## Public API

| Export | Purpose |
| --- | --- |
| `defaultQuotaConfig` | Parsed policy loaded from JSON at import time |
| `resolveCountryQuota(config, code)` | Country entry, or the default for unknown codes |
| `listCountryQuotas(config)` | Sorted matrix for UIs and the SDK |
| `validateQuotaMatrix(config)` | Duplicate countries and unknown time zones |
| `resolveEntitlements(quota, plan)` | Hours, ad eligibility and premium model access |
| `evaluateQuota(input)` | Pure snapshot plus allow/deny decision |
| `QuotaService` | `snapshot()` and `beginHour()` against a `QuotaStore` |
| `InMemoryQuotaStore` | Test/dev store; the web app uses SQLite |

`resolveEntitlements` is the only place that maps a plan to an allowance, ad
eligibility and model access, so a surface cannot offer "paid with ads" or
"free with premium models".

## Accounting rules

- One hour is charged when an hour is opened; messages inside it are free.
- A new local day starts at zero — unused hours never carry forward.
- A build is refused when the remaining allowance is less than one hour.
- The free tier requires a verified phone number (`phone_verification_required`).
- Suspended accounts are denied before anything else is considered.

## Tests

`tests/unit/quota/matrix.test.ts` and `tests/unit/quota/quota.test.ts` cover the
matrix, fallbacks, entitlements, local-day maths, active-hour reuse and
exhaustion.
