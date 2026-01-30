# Stripe Setup

## Local Development

### 1. Create a Stripe account

Sign up at [dashboard.stripe.com](https://dashboard.stripe.com/register) if you haven't already.

### 2. Create a product

1. Make sure you're in **test mode** (toggle in the top right)
2. Go to **Products** → **Add product**
3. Name it something like "Premium Subscription"
4. Add a price: $5/month, recurring
5. Save and copy the price ID (starts with `price_`)

### 3. Get your test API key

1. Go to **Developers** → **API keys**
2. Copy the **Secret key** (starts with `sk_test_`)

### 4. Set up webhook forwarding

Install the Stripe CLI:

```bash
brew install stripe/stripe-cli/stripe
```

Log in and start forwarding:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the webhook signing secret it prints (starts with `whsec_`).

### 5. Add to `.env.local`

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
```

### 6. Test it

```bash
pnpm dev
```

Use card `4242 4242 4242 4242` with any future expiry and any CVC.

---

## Production (Vercel)

### 1. Create a live product

1. Switch to **live mode** in Stripe dashboard
2. Create the same product/price as in test mode (or use a different price)
3. Copy the live price ID

### 2. Get your live API key

1. Go to **Developers** → **API keys** (in live mode)
2. Copy the **Secret key** (starts with `sk_live_`)

### 3. Create a webhook endpoint

1. Go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Set the URL to `https://your-domain.vercel.app/api/stripe/webhook`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_`)

### 4. Add environment variables in Vercel

Go to your project → **Settings** → **Environment Variables** and add:

| Name | Value |
|------|-------|
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `STRIPE_PRICE_ID` | `price_...` |

### 5. Deploy

```bash
vercel --prod
```

Or push to your connected git branch.

---

## Testing Webhooks

To verify webhooks are working:

**Locally:** Check the terminal running `stripe listen` — you'll see events logged.

**Production:** Go to **Developers** → **Webhooks** → your endpoint → **Logs** to see delivery attempts.

---

## Useful Test Cards

| Card | Behavior |
|------|----------|
| `4242 4242 4242 4242` | Succeeds |
| `4000 0000 0000 3220` | Requires 3D Secure |
| `4000 0000 0000 9995` | Declines (insufficient funds) |

Full list: [Stripe testing docs](https://docs.stripe.com/testing)

---

## Coupons / Promotion Codes

Create a 100% off coupon to test the production flow without being charged.

### Create a coupon

1. Go to **Products** → **Coupons** → **Create coupon**
2. Set:
   - Percentage off: `100%`
   - Duration: `forever` (or `once` for first month free)
   - Redemption limits: optional
3. Click **Create coupon**

### Create a promotion code

1. On the coupon page, go to **Promotion codes** tab
2. Click **Create code**
3. Enter a code like `TESTING100`
4. Save

Users will see "Add promotion code" on the checkout page.

---

## Testing Subscription Flows

Make sure `stripe listen` is running and your app is on `localhost:3000`.

### 1. Subscribe

1. Sign in to the app
2. Go to `/account` and click **Subscribe Now**
3. Use card `4242 4242 4242 4242`, any future expiry, any CVC
4. Complete checkout — you'll redirect back to `/account`
5. Verify: green "Active Subscription" badge, premium posts are unlocked

### 2. Cancel (with renewal option)

1. Click **Manage Billing** → opens Stripe portal
2. Click **Cancel plan** → confirm
3. Back in the app, run sync to pull the updated state:
   ```bash
   export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/sync-stripe.ts
   ```
4. Refresh `/account`
5. Verify: yellow "Subscription Ending" badge with end date, **Renew Subscription** button
6. Premium content should still be accessible until the end date

### 3. Renew (undo cancellation)

1. Click **Renew Subscription** → opens Stripe portal
2. Click **Don't cancel subscription**
3. Run sync again and refresh
4. Verify: back to green "Active Subscription"

### 4. Hard cancel (immediate revocation)

Cancel the subscription in Stripe and sync local data:

```bash
export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/cancel-subscription.ts you@email.com
```

Refresh `/account`:
- Should show the amber "Subscribe" prompt
- Premium posts should show paywall

To test the locked-out state **without** touching Stripe (local only):

```bash
export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/set-subscription.ts you@email.com canceled
```

### 5. Reset to active

```bash
export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/set-subscription.ts you@email.com active
```

### Quick reference

| Command | Result |
|---------|--------|
| `cancel-subscription.ts <email>` | Cancel in Stripe + sync locally |
| `sync-stripe.ts [email]` | Pull real state from Stripe |
| `set-subscription.ts <email> active` | Local only: full access, green badge |
| `set-subscription.ts <email> canceling` | Local only: access until fake date (7 days), yellow badge |
| `set-subscription.ts <email> canceled` | Local only: no access, subscribe prompt |
| `set-subscription.ts <email> none` | Local only: clear subscription data |
