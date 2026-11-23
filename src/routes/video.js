const express = require("express");
const { userAuth } = require("../middlewares/auth");
const { iceConfig } = require("../utils/iceConfig");
const router = express.Router();
router.get("/video/ice", userAuth, (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!req.app.locals.videoCalls.hasCall(req.user._id)) return res.status(403).json({ error: "An active call is required." });
  try { res.json(iceConfig(req.user._id)); }
  catch { res.status(503).json({ error: "Video relay configuration is unavailable." }); }
});
module.exports = router;
