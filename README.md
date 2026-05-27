# Reservation Lock Contention Simulator

A browser-based simulation showing how per-reservation distributed locks,
multi-step API plans, and slow PMS responses cascade into timeouts as
inbound traffic ramps up.

## Run it

Open `index.html` in any modern browser. No build step, no server.

## What's modeled

- **Lock scope:** one distributed lock per reservation, keyed by hotel +
  confirmation number. Concurrent actions on the same reservation
  serialize through the lock.
- **Wait budget:** waiters retry lock acquisition every 0.5s for up to 180
  attempts (90 seconds total) before timing out.
- **Plan length:** realistic hospitality action mix — pre-check-in is
  3 API steps, post-notes / update-guest / get-folios / post-payment-method
  are 2 steps, refresh is 1 step. Each step holds the lock for the full
  PMS response time.
- **Transient retries:** ~10% of fetches hit a transient "not finalized"
  warning and retry once after a 10s cool-off, inflating lock-hold time.
- **Hot-reservation skew:** arrival-day clustering — a configurable share
  of traffic targets the 10 hottest reservations to expose contention.

## Controls

| Slider | Range | What it changes |
| --- | --- | --- |
| PMS per-step response time | 5–60s | How long the PMS takes per API step (lock-hold per step). |
| Inbound API traffic | 0.1–20 req/sec | Property-wide arrival rate. |
| Hot-reservation skew | 0–80% | Share of traffic hitting the 10 hottest reservations. |
| Active reservations | 20–500 | Total reservation pool size. |
| Time acceleration | 1×–120× | Sim runs faster than wall-clock. |

## Views

- **Locks & queue over time** — active locks (blue), queued waiters
  (purple), timeouts/sec (red).
- **Lock wait time distribution** — histogram in 5s buckets; the rightmost
  red bar is the ≥ 90s timeout bucket.
- **Hot reservation #0 — request trace** — Gantt-style trace of the last
  ~25 requests on the hottest reservation. Gray = wait, color = lock-hold,
  red ✕ = timeout. Color matches the breakdown panel.
- **By action kind** — per-action share of traffic + timeout count + avg
  lock-wait, rolling 60s window.
- **Reservation lock state** — grid view of the first 80 reservations,
  shaded by queue depth and recent timeouts.
