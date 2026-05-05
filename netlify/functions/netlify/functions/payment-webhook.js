const crypto = require("crypto");

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: "Method Not Allowed"
      };
    }

    const secret = process.env.NOWPAYMENTS_IPN_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!secret || !SUPABASE_URL || !SERVICE_KEY) {
      return {
        statusCode: 500,
        body: "Missing server configuration"
      };
    }

    const signature =
      event.headers["x-nowpayments-sig"] ||
      event.headers["X-Nowpayments-Sig"];

    if (!signature) {
      return {
        statusCode: 401,
        body: "Missing signature"
      };
    }

    const expectedSignature = crypto
      .createHmac("sha512", secret)
      .update(event.body || "")
      .digest("hex");

    if (signature !== expectedSignature) {
      return {
        statusCode: 401,
        body: "Invalid signature"
      };
    }

    const body = JSON.parse(event.body || "{}");

    if (
      body.payment_status !== "finished" &&
      body.payment_status !== "confirmed"
    ) {
      return {
        statusCode: 200,
        body: "Ignored"
      };
    }

    const email = body.order_description?.split("|")[1]?.trim()?.toLowerCase();

    if (!email || !email.includes("@")) {
      return {
        statusCode: 400,
        body: "Missing email"
      };
    }

    const proUntil = new Date();
    proUntil.setMonth(proUntil.getMonth() + 1);

    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?on_conflict=email`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates"
        },
        body: JSON.stringify({
          email,
          is_pro: true,
          plan: "pro",
          pro_until: proUntil.toISOString(),
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!profileRes.ok) {
      const detail = await profileRes.text();
      return {
        statusCode: 500,
        body: "Profile update failed: " + detail
      };
    }

    await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        order_id: body.order_id,
        payment_id: String(body.payment_id || body.invoice_id || body.order_id),
        amount: body.price_amount,
        currency: body.price_currency,
        status: body.payment_status,
        raw: body,
        created_at: new Date().toISOString()
      })
    });

    return {
      statusCode: 200,
      body: "OK"
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: "Server error: " + err.message
    };
  }
};
