const express = require("express");

const app = express();

//Handle Auth Middleware for all GET, POST, ... requests
app.use("/admin", (req, res, next) => {
    console.log("Admin auth is getting checked!!");
    const token = "xyz";
    const isAdminAuthorized = token === "xyz";
    if(!isAdminAuthorized){
        res.status(401).send("Unauthorized request")
    }else{
        next();
    }
});

app.get("/user", (req, res) =>{
    res.send("User Data Sent");
});

app.get("/admin/getAllData", (req, res) => {
        res.send("All Data Sent");
});

app.get("/admin/deleteUser", (req, res) => {
        res.send("Deleted a user");
});

app.listen(7777, () => {
    console.log("Server is successfully listening on port 7777...");
});