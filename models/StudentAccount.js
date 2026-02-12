const mongoose = require("mongoose");

const StudentAccountSchema = new mongoose.Schema(
  {
    lrn: { type: String, required: true, unique: true },
    name: { type: String, required: true }, // "Last, First Middle"
    passwordHash: { type: String, required: true },
    mustChangePassword: { type: Boolean, default: true },
    disabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.StudentAccount ||
  mongoose.model("StudentAccount", StudentAccountSchema);
