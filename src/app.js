const express = require ("express");

const app = express();

app.use("/test", (req, res) => {
    res.send("Hello from the server 1!");
});

app.use("/", (req, res) => {
    res.send("Welcome to the Dashboard!");
});


app.listen(7777, () => {
    console.log("Server is successfully listening on port 7777...");
});