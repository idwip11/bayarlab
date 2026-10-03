import { verifyMidtrans } from "../../../../../shared/verify-midtrans.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON payload" }, { status: 400 });
  }

  const serverKey = process.env.BAYARLAB_MIDTRANS_TEST_KEY ?? "bayarlab-local-test-key";
  if (!verifyMidtrans(payload, serverKey)) {
    return Response.json({ error: "invalid Midtrans signature" }, { status: 401 });
  }
  return Response.json({ received: true, order_id: payload.order_id });
}
