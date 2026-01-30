import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { adminDb } from "@/lib/adminDb";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: "User ID required" }, { status: 400 });
    }

    const { $users } = await adminDb.query({
      $users: { $: { where: { id: userId } } },
    });

    const user = $users[0];
    if (!user?.stripeCustomerId) {
      return NextResponse.json({ synced: false });
    }

    const stripe = getStripe();

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

    return NextResponse.json({ synced: true });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
