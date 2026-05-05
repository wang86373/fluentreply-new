exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    const { email } = JSON.parse(event.body || "{}");

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing email" })
      };
    }

    const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
    const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");

    const orderId = `fluentreply_${Date.now()}`;

    const response = await fetch("https://api.nowpayments.io/v1/invoice", {
      method: "POST",
      headers: {
        "x-api-key": NOWPAYMENTS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        price_amount: 12,
        price_currency: "usd",
        order_id: orderId,
        order_description: `FluentReply Pro | ${email}`,
        success_url: `${SITE_URL}/success.html?order_id=${orderId}`,
        cancel_url: SITE_URL,
        ipn_callback_url: `${SITE_URL}/.netlify/functions/payment-webhook`
      })
    });

    const data = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify({
        invoice_url: data.invoice_url,
        order_id: orderId
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server error",
        detail: error.message
      })
    };
  }
};
