// services/fcm.service.js
const fs = require("fs");
const admin = require("firebase-admin");

let initialized = false;

function initFirebaseAdmin() {
  if (initialized || admin.apps.length) return;

  const p = process.env.FCM_SERVICE_ACCOUNT_PATH || "C:\\fcm\\service-account.json";
  const sa = JSON.parse(fs.readFileSync(p, "utf8"));

  admin.initializeApp({
    credential: admin.credential.cert(sa),
  });

  initialized = true;
  console.log("✅ Firebase Admin inicializado. project_id:", sa.project_id);
}

async function sendToTokens(tokens, { title, body, data = {} }) {
  initFirebaseAdmin();

  const unique = [...new Set((tokens || []).filter(Boolean))];
  if (unique.length === 0) {
    return { ok: true, sent: 0, badTokens: [], successCount: 0, failureCount: 0 };
  }

  // ✅ DATA-ONLY (evita duplicado automático de Android)
  const payloadData = {
    title: String(title || "GeoApp"),
    body: String(body || ""),
    ...Object.fromEntries(
      Object.entries(data || {}).map(([k, v]) => [k, v == null ? "" : String(v)])
    ),
  };

  const res = await admin.messaging().sendEachForMulticast({
    tokens: unique,
    data: payloadData,
    android: { priority: "high" },
  });

  const badTokens = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error?.errorInfo?.code || "";
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        badTokens.push(unique[i]);
      }
    }
  });

  return {
    ok: true,
    sent: unique.length,
    successCount: res.successCount,
    failureCount: res.failureCount,
    badTokens,
  };
}

module.exports = { initFirebaseAdmin, sendToTokens };
