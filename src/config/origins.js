module.exports = () => (process.env.CLIENT_ORIGINS || "http://localhost:5173,https://devtinder.work")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
