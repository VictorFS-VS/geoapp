// scripts/test_fcm_sa.js
require("dotenv").config();
const fs = require("fs");

const p =
  process.env.FCM_SERVICE_ACCOUNT_PATH || "C:\\fcm\\service-account.json";

console.log("📌 leyendo:", p);

const sa = JSON.parse(fs.readFileSync(p, "utf8"));

console.log("✅ service account email:", sa.client_email);
console.log("✅ project_id:", sa.project_id);
