const express = require("express");

const app = express();

// GET /users => middleware chain => request handlet

app.use("/", (req, res, next) => {
    // res.send("Handling /route");   
    next(); 
});

app.get(
    "/user",
    (req, res, next) => {
     console.log("Handling /user route");
        next();
    },
    (req, res, next) => {
        next();
    },
    (req, res, next) => {
        res.send("2nd Route Handler");
    }
);

app.listen(7777, () => {
    console.log("Server is successfully listening on port 7777...");
});