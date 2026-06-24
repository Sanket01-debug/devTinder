const express = require('express')
const profileRouter = express.Router();

const { userAuth } = require("../middlewares/auth");
const { validateEditProfileData, validatePasswordEdit } = require("../utils/validation")



profileRouter.get("/profile/view", userAuth, async (req, res) => {

  try {

    const user = req.user;
    res.send(user);
  } catch (err) {
    res.status(400).send("ERROR : " + err.message);
  }

});

profileRouter.patch("/profile/edit", userAuth, async (req, res) => {
  try {
    if (!validateEditProfileData(req)) {
      throw new Error("Inavlid Edit Request");
    }

    const loggedInUser = req.user;

    Object.keys(req.body).forEach((key) => (loggedInUser[key] = req.body[key]));

    await loggedInUser.save();

    res.json({
      message: `${loggedInUser.firstName}, your profile updated successfully`,
      data: loggedInUser,
    });

  } catch (err) {
    res.status(400).send("ERROR : " + err.message);
  }
});

profileRouter.patch("/profile/password", userAuth, async (req, res) => {
  try {
    validatePasswordEdit(req);

    const { oldPassword, newPassword } = req.body;

    const loggedInUser = req.user;

    const isPasswordValid = await bcrypt.compare(
      oldPassword,
      loggedInUser.password
    );

    if (!isPasswordValid) {
      throw new Error("Old password is incorrect");
    }

    loggedInUser.password = await bcrypt.hash(newPassword, 10);

    await loggedInUser.save();

    res.send("Password updated successfully");
  } catch (err) {
    res.status(400).send("ERROR : " + err.message);
  }
});

module.exports = profileRouter;