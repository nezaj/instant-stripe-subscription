import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { adminDb } from "@/lib/adminDb";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: "User ID required" }, { status: 400 });
    }

    // Get user from InstantDB
    const { $users } = await adminDb.query({
      $users: { $: { where: { id: userId } } },
    });

    const user = $users[0];
    if (!user?.stripeCustomerId) {
      return NextResponse.json(
        { error: "No subscription found" },
        { status: 404 }
      );
    }

    const stripe = getStripe();

    // Sync subscription status before opening portal
    const subscriptions = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      limit: 1,
    });

    const subscription = subscriptions.data[0] as
      | (typeof subscriptions.data)[0] & { cancel_at: number | null }
      | undefined;

    await adminDb.transact(
      adminDb.tx.$users[userId].update({
        subscriptionStatus: subscription?.status ?? null,
        cancelAt: subscription?.cancel_at ?? null,
      })
    );

    // Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${request.headers.get("origin")}/account`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Portal error:", error);
    return NextResponse.json(
      { error: "Failed to create portal session" },
      { status: 500 }
    );
  }
}
