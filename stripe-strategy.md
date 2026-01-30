# Stripe Integration Strategy

This document explains how payments and subscriptions work in this app.

## Philosophy

**Stripe is the source of truth.** Our database (InstantDB) is a cache of Stripe's state. Whenever there's uncertainty, we fetch from Stripe and update our cache.

This avoids "split-brain" issues where Stripe says one thing and our database says another.

## Data Model

```
┌─────────────────────────────────────┐
│              $users                 │
├─────────────────────────────────────┤
│  id                    string       │
│  email                 string       │
│  stripeCustomerId      string  ─────┼──────┐
│  subscriptionStatus    string       │      │
│  cancelAt              number       │      │
└─────────────────────────────────────┘      │
                                             │
                    ┌────────────────────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │   Stripe Customer   │
         ├─────────────────────┤
         │  id                 │
         │  email              │
         │  subscriptions[] ───┼────────┐
         └─────────────────────┘        │
                                        │
                    ┌───────────────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │  Stripe Subscription│
         ├─────────────────────┤
         │  id                 │
         │  status             │
         │  cancel_at          │
         └─────────────────────┘
```

We store minimal Stripe data on the user:
- `stripeCustomerId` — links to Stripe
- `subscriptionStatus` — "active", "canceled", etc.
- `cancelAt` — timestamp when subscription ends (if canceling)

## Subscription Flow

```
┌──────┐          ┌─────┐          ┌────────────────────┐          ┌────────┐          ┌───────────┐
│ User │          │ App │          │ /api/stripe/checkout│         │ Stripe │          │ InstantDB │
└──┬───┘          └──┬──┘          └─────────┬──────────┘          └───┬────┘          └─────┬─────┘
   │                 │                       │                         │                      │
   │ Click Subscribe │                       │                         │                      │
   │────────────────>│                       │                         │                      │
   │                 │                       │                         │                      │
   │                 │  POST { userId }      │                         │                      │
   │                 │──────────────────────>│                         │                      │
   │                 │                       │                         │                      │
   │                 │                       │  No customer? Create    │                      │
   │                 │                       │────────────────────────>│                      │
   │                 │                       │                         │                      │
   │                 │                       │  Save stripeCustomerId  │                      │
   │                 │                       │─────────────────────────┼─────────────────────>│
   │                 │                       │                         │                      │
   │                 │                       │  Has subscription?      │                      │
   │                 │                       │────────────────────────>│                      │
   │                 │                       │                         │                      │
   │                 │                       │◄────────────────────────│                      │
   │                 │                       │                         │                      │
   │                 │    ┌──────────────────┴──────────────────┐      │                      │
   │                 │    │ If has subscription → portal URL    │      │                      │
   │                 │    │ If no subscription → checkout URL   │      │                      │
   │                 │    └──────────────────┬──────────────────┘      │                      │
   │                 │                       │                         │                      │
   │                 │◄──────────────────────│                         │                      │
   │                 │                       │                         │                      │
   │  Redirect to Stripe                     │                         │                      │
   │◄────────────────│                       │                         │                      │
   │                 │                       │                         │                      │
   │  Complete payment                       │                         │                      │
   │────────────────────────────────────────────────────────────────>│                      │
   │                 │                       │                         │                      │
   │  Redirect to /account?success=true      │                         │                      │
   │◄────────────────────────────────────────────────────────────────│                      │
   │                 │                       │                         │                      │
   │                 │  POST /api/stripe/sync│                         │                      │
   │                 │──────────────────────>│  Fetch subscription     │                      │
   │                 │                       │────────────────────────>│                      │
   │                 │                       │◄────────────────────────│                      │
   │                 │                       │  Update status          │                      │
   │                 │                       │─────────────────────────┼─────────────────────>│
   │                 │                       │                         │                      │
   │                 │                       │    Webhook (backup)     │                      │
   │                 │                       │◄────────────────────────│                      │
   │                 │                       │                         │                      │
```

## Sync Strategy

We sync Stripe data to our database in multiple places:

```
                            ┌─────────────────┐
                            │   User Action   │
                            └────────┬────────┘
                                     │
                                     ▼
                    ┌────────────────────────────────┐
                    │         Which action?          │
                    └────────────────────────────────┘
                       │         │         │         │
          ┌────────────┘         │         │         └────────────┐
          │                      │         │                      │
          ▼                      ▼         ▼                      ▼
   ┌─────────────┐    ┌─────────────┐ ┌─────────────┐    ┌─────────────┐
   │  Checkout   │    │   Portal    │ │   Success   │    │   Webhook   │
   │   Route     │    │   Route     │ │    Page     │    │   Handler   │
   └──────┬──────┘    └──────┬──────┘ └──────┬──────┘    └──────┬──────┘
          │                  │               │                  │
          └──────────────────┴───────┬───────┴──────────────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │   Sync from Stripe  │
                          │                     │
                          │  1. Fetch sub data  │
                          │  2. Update InstantDB│
                          └─────────────────────┘
```

### Why sync in multiple places?

1. **Checkout route** — Catches existing subscriptions before creating duplicates
2. **Portal route** — Syncs before user sees billing portal (catches cancellations)
3. **Success page** — Eagerly syncs after payment (beats the webhook race)
4. **Webhook** — Backup for all Stripe events

## Webhook Events

We listen for these events:

| Event | What it means |
|-------|---------------|
| `checkout.session.completed` | User finished checkout |
| `customer.subscription.updated` | Subscription changed (canceled, renewed, etc.) |
| `customer.subscription.deleted` | Subscription fully ended |

## Content Protection

Premium content is protected at the **database level**, not just UI:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        User requests post                           │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │  InstantDB Permission  │
                    │                        │
                    │  posts.content rule:   │
                    │  "!data.isPremium ||   │
                    │   auth.subscriptionStatus│
                    │   == 'active'"         │
                    └───────────┬────────────┘
                                │
               ┌────────────────┼────────────────┐
               │                │                │
               ▼                ▼                ▼
        ┌────────────┐   ┌────────────┐   ┌────────────┐
        │ Not premium│   │  Premium + │   │  Premium + │
        │            │   │ subscribed │   │    NOT     │
        │            │   │            │   │ subscribed │
        └─────┬──────┘   └─────┬──────┘   └─────┬──────┘
              │                │                │
              ▼                ▼                ▼
        ┌────────────┐   ┌────────────┐   ┌────────────┐
        │  Return    │   │  Return    │   │  Return    │
        │  content   │   │  content   │   │   null     │
        └─────┬──────┘   └─────┬──────┘   └─────┬──────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   App checks if     │
                    │   content exists    │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
     ┌─────────────────┐              ┌─────────────────┐
     │  content != null│              │  content == null│
     │                 │              │                 │
     │  Show full      │              │  Show teaser +  │
     │  article        │              │  paywall        │
     └─────────────────┘              └─────────────────┘
```

## Handling Edge Cases

### Test mode vs Live mode

Stripe test and live modes are completely separate. A test mode `stripeCustomerId` won't work in live mode.

We handle this by catching "No such customer" errors and auto-healing:

```
┌─────────────────────┐
│  API call to Stripe │
└──────────┬──────────┘
           │
           ▼
   ┌───────────────┐
   │   Customer    │
   │   exists?     │
   └───────┬───────┘
           │
     ┌─────┴─────┐
     │           │
     ▼           ▼
   ┌───┐      ┌─────┐
   │Yes│      │ No  │
   └─┬─┘      └──┬──┘
     │           │
     │           ▼
     │    ┌─────────────────┐
     │    │ Clear local     │
     │    │ stripeCustomerId│
     │    └────────┬────────┘
     │             │
     │             ▼
     │    ┌─────────────────┐
     │    │ Create new      │
     │    │ customer        │
     │    └────────┬────────┘
     │             │
     └──────┬──────┘
            │
            ▼
   ┌─────────────────┐
   │ Continue normally│
   └─────────────────┘
```

### Cancellation States

```
                              ┌─────────────────┐
                              │ No Subscription │
                              └────────┬────────┘
                                       │
                                       │ Subscribes
                                       ▼
                    Renews    ┌─────────────────┐
               ┌──────────────│     Active      │◄─────────────┐
               │              └────────┬────────┘              │
               │                       │                       │
               │          Cancels      │      Immediate        │ Resubscribes
               │       (end of period) │        cancel         │
               │                       ▼                       │
               │              ┌─────────────────┐              │
               └──────────────│    Canceling    │              │
                              └────────┬────────┘              │
                                       │                       │
                                       │ Period ends           │
                                       ▼                       │
                              ┌─────────────────┐              │
                              │    Canceled     │──────────────┘
                              └─────────────────┘
```

- **Active** — Full access, green badge
- **Canceling** — Still has access until `cancelAt` date, yellow badge
- **Canceled** — No access, must resubscribe

## File Structure

```
src/app/api/stripe/
├── checkout/route.ts  # Creates checkout sessions
├── portal/route.ts    # Opens billing portal
├── sync/route.ts      # Syncs user data from Stripe
└── webhook/route.ts   # Handles Stripe events

scripts/
├── sync-stripe.ts          # Sync all users or one user
├── set-subscription.ts     # Manually set status (testing)
├── cancel-subscription.ts  # Cancel in Stripe + sync
└── clear-stripe-data.ts    # Clear local Stripe data
```
