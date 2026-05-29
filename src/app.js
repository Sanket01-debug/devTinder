const express = require("express");

const app = express();

//Handle Auth Middleware for all GET, POST, ... requests
app.use("/admin", (req, res, next) => {
    const token = "xyza";
    const isAdminAuthorized = token === "xyz";
    if(!isAdminAuthorized){
        res.status(401).send("Unauthorized request")
    }else{
        next();
    }
});

app.get("/admin/getAllData", (req, res) => {
    // Logic of checking if the request is authorized
    const token = "xyza";
    const isAdminAuthorized = token === "xyz";
    if(isAdminAuthorized){
        res.send("All Data Sent");
    }else{
        res.status(401).send("Unauthorized request");
    }
});

app.get("/admin/deleteUser", (req, res) => {
    // Logic of checking if the request is authorized
    const token = "xyza";
    const isAdminAuthorized = token === "xyz";
    if(isAdminAuthorized){
        res.send("Deleted a user");
    }else{
        res.status(401).send("Unauthorized request");
    }});

app.listen(7777, () => {
    console.log("Server is successfully listening on port 7777...");
});