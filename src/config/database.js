const mongoose = require('mongoose');

const connectDB = async() => {
    await mongoose.connect(
        "mongodb+srv://namastedev:cJV2SJqXQpr29KGC@namastenode.6ec0vpg.mongodb.net/devTinder"
    );
};

module.exports = connectDB;