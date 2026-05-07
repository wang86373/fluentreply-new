// netlify/functions/create-payment.js
const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
exports.handler = async function (event) {
  try {
    if (event.httpMethod === "OPTIONS") {
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: ""
  };
}
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: "Method Not Allowed"
      };
    }

    const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
    const SITE_URL = process.env.SITE_URL;

    if (!NOWPAYMENTS_API_KEY || !SITE_URL) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Missing server configuration"
        })
      };
    }

    const body = JSON.parse(event.body || "{}");

    const email = (body.email || "").trim().toLowerCase();
    const plan = body.plan || "pro";
    const months = Math.max(1, Math.min(12, Number(body.months || 1)));

    if (!["pro", "pro_plus"].includes(plan)) {
  return {
    statusCode: 400,
    headers: corsHeaders,
    body: JSON.stringify({
      error: "Invalid plan"
    })
  };
}

    if (!email || !email.includes("@")) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Invalid email"
        })
      };
    }

    // ✅ 价格设置
    let priceAmount = 12 * months;
    let planName = "Pro Plan";

    if (plan === "pro_plus") {
      priceAmount = 29 * months;
      planName = "Pro Plus Plan";
    }

    // ✅ 订单ID（必须唯一）
    const orderId = `fluentreply_${Date.now()}_${plan}_${months}m`;

    // ✅ 创建支付（核心）
    const paymentRes = await fetch("https://api.nowpayments.io/v1/invoice", {
      method: "POST",
      headers: {
        "x-api-key": NOWPAYMENTS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        price_amount: priceAmount,
        price_currency: "usd",

        order_id: orderId,
        order_description: `${planName} | ${email}`,

        success_url: `${SITE_URL}/success.html?order_id=${orderId}&plan=${plan}`,
        cancel_url: SITE_URL,

        ipn_callback_url: `${SITE_URL}/.netlify/functions/payment-webhook`,

        // 🔥 关键修复：手续费由用户承担
        is_fee_paid_by_user: true
      })
    });

    let rawText = "";
let data = {};

try{
  rawText = await paymentRes.text();
  data = JSON.parse(rawText);
}catch(parseError){

  console.error(
    "NOWPayments response parse failed:",
    parseError
  );

  console.log(
    "NOWPayments raw response:",
    rawText
  );

  return {
    statusCode: 500,
    headers: corsHeaders,
    body: JSON.stringify({
      error: "Invalid payment server response"
    })
  };
}

    if (!paymentRes.ok) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Payment creation failed",
          detail: data
        })
      };
    }

    // ✅ 返回支付页面
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        invoice_url: data.invoice_url,
        id: data.id
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Server error",
        message: err.message
      })
    };
  }
};
