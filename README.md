# The Weekly Dispatch

A mini newsletter app with paid subscriptions. Built with [InstantDB](https://instantdb.com) + [Stripe](https://stripe.com) + Next.js.

## Setup

```bash
pnpm install
```

Copy `.env.example` to `.env` and fill in your InstantDB credentials (should already be there if you used `create-instant-app`).

Push the schema:

```bash
npx instant-cli push schema --yes
npx instant-cli push perms --yes
```

Seed sample posts:

```bash
source .env && pnpm tsx scripts/seed.ts
```

## Stripe Setup

1. Create a [Stripe account](https://dashboard.stripe.com/register) (or use an existing one)

2. In test mode, create a product with a $5/month recurring price

3. Add to your `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PRICE_ID=price_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

4. Install the Stripe CLI and forward webhooks locally:
   ```bash
   brew install stripe/stripe-cli/stripe
   stripe login
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
   Copy the webhook signing secret it prints to `STRIPE_WEBHOOK_SECRET`.

5. Run the app:
   ```bash
   pnpm dev
   ```

Use test card `4242 4242 4242 4242` with any future expiry and CVC.

## Testing Subscriptions

To manually set a user's subscription status (useful for testing the locked/unlocked states):

```bash
source .env && pnpm tsx scripts/set-subscription.ts user@email.com active
source .env && pnpm tsx scripts/set-subscription.ts user@email.com canceled
```

## Project Structure

- `/` — Post feed
- `/posts/[id]` — Post detail (with paywall for premium)
- `/account` — Sign in + manage subscription
- `/api/stripe/*` — Checkout, webhook, and billing portal endpoints
