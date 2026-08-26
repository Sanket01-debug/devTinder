const mongoose = require('mongoose');
console.log(process.env.MONGO_URI)

const connectDB = async() => {
    await mongoose.connect(process.env.MONGO_URI);
};

module.exports = connectDB;