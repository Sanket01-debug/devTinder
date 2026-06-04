const express = require("express");
const connectDB = require("./config/database");
const app = express();
const User = require("./models/user");

app.post("/signup", async (req, res)=>{
  // Creating a new instance of the User model
  const user = new User({
    firstName: "Virat",
    lastName: "Kohli",
    emailId: "viratKohli101@gmail.com",
    password: "virat@123"
  });

  await user.save();
  res.send("User added successfully");

})


connectDB()
  .then(()=>{
    console.log("Database connection established...");
    app.listen(7777, () => {
        console.log("Server is successfully listening on port 7777...");
    });
})
.catch(()=>{
      console.log("Database cannot be connected!!");
});

