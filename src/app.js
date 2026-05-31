const express = require("express");

const app = express();

app.use('/', (err, req, res, next) => {
    if (err) {
        res.status(500).send("something went wrong");
    }
})

app.get("/getUserData", (req, res) => {
    // try {
    // Logic of db call and get User data
    throw new Error("dnjnd");
    res.send("User Data Sent");
    // } catch (err) {
    //     res.status(500).send("Some Error contact support team"); 
    // }
});

app.use('/', (err, req, res, next) => {
    if (err) {
        res.status(500).send("something went wrong");
    }
})

app.listen(7777, () => {
    console.log("Server is successfully listening on port 7777...");
});