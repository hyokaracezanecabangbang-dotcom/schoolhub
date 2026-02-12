const mongoose = require("mongoose");

const AdminAccountSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true },
    name: { type: String, default: "Admin" },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdminAccount", AdminAccountSchema);
