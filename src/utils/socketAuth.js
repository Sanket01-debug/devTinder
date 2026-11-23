const jwt = require("jsonwebtoken");
const User = require("../models/user");
const cookieParser = require("cookie-parser");

const authenticateSocket = (socket, next) => {
  const req = { headers: socket.request.headers };
  cookieParser()(req, {}, async () => {
    try {
      const payload = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
      const user = await User.findById(payload._id).select("firstName lastName photoUrl");
      if (!user || !payload.exp) throw new Error("Unauthorized");
      socket.data.user = user;
      socket.data.expiresAt = payload.exp * 1000;
      next();
    } catch {
      next(new Error("Please log in to connect."));
    }
  });
};
module.exports = { authenticateSocket };
