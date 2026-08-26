const express = require("express");
const sendEmail = require("../utils/sendEmail");
const authRouter = express.Router();

const { validateSignUpData } = require("../utils/validation");
const User = require("../models/user");
const bcrypt = require("bcrypt");

authRouter.post("/signup", async (req, res) => {
  try {
    // Validation of data
    validateSignUpData(req);

    const { firstName, lastName, emailId, password } = req.body;

    // Encrypt the password
    const passwordHash = await bcrypt.hash(password, 10);
    console.log(passwordHash);

    // Creating a new instance of the User model
    const user = new User({
      firstName,
      lastName,
      emailId,
      password: passwordHash,
    });

    // Save user to database
    const savedUser = await user.save();

    console.log("USER SAVED:", savedUser.emailId);

    // Send welcome email
    await sendEmail({
      to: emailId,
      subject: "Welcome to DevTinder!",
      html: `
        <h2>Welcome to DevTinder, ${firstName}!</h2>
        <p>Your account has been successfully created.</p>
        <p>We are happy to have you on DevTinder.</p>
      `,
    });

    console.log("EMAIL FUNCTION COMPLETED");

    // Generate JWT token
    const token = await savedUser.getJWT();

    // Store token in cookie
    res.cookie("token", token, {
      expires: new Date(Date.now() + 8 * 3600000),
    });

    res.json({
      message: "User Added successfully!",
      data: savedUser,
    });
  } catch (err) {
    console.error("Signup Error:", err);
    res.status(400).send("ERROR : " + err.message);
  }
});

authRouter.post("/login", async (req, res) => {
  try {
    const { emailId, password } = req.body;

    const user = await User.findOne({ emailId: emailId });

    if (!user) {
      throw new Error("Invalid credentials");
    }

    const isPasswordValid = await user.validatePassword(password);

    if (isPasswordValid) {
      const token = await user.getJWT();

      res.cookie("token", token, {
        expires: new Date(Date.now() + 8 * 3600000),
      });

      res.send(user);
    } else {
      throw new Error("Invalid credentials");
    }
  } catch (err) {
    res.status(400).send("ERROR : " + err.message);
  }
});

authRouter.post("/logout", async (req, res) => {
  res.cookie("token", null, {
    expires: new Date(Date.now()),
  });

  res.send("Logout Successful!!");
});

module.exports = authRouter;