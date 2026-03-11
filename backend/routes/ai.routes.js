const express = require("express");
const OpenAI = require("openai");

const router = express.Router();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// POST /api/ai/test
router.post("/test", async (req, res) => {
  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: "Respondé solo con: OK desde GeoApp",
    });

    const text =
      response.output_text ||
      response.output?.map(o => o?.content?.map(c => c?.text).join("")).join("") ||
      "";

    res.json({ ok: true, text });
  } catch (err) {
    console.error("AI ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
