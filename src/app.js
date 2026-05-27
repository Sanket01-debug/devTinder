const express = require ("express");

const app = express();

// This will only handle GET call to /user
app.get("/user/:userID/:name/:password", (req, res) => {
    console.log(req.params)
    res.send({ firstName: "Sanket", lastName: "Kansal" });
});

app.listen(7777, () => {
    console.log("Server is successfully listening on port 7777...");
});