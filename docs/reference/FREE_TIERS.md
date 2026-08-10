# Free tiers

OmniRoute aggregates documented provider free tiers and shows them on `/dashboard/free-tiers`.

## ToS-flagged free-tier providers

Free-tier providers marked with a ToS flag are still included in routing and fallback by default. The flag is advisory only: it is shown on `/dashboard/free-tiers` and may be used by `/api/free-tier/summary`, but it does not disable the provider or change routing behavior.

The `excludeTosAvoid` query parameter affects the summary view only; it is not a global routing gate. If you want to avoid ToS-flagged providers, explicitly omit them from your configured routes/pools.

## Dashboard microcopy

ToS flag is informational only. These providers remain routable unless explicitly excluded from your route configuration.

## Source of the advisory flag

The advisory `tos` verdict is defined in `open-sse/config/freeTierCatalog.ts`. It is not read by the routing, combo, or fallback engines.
