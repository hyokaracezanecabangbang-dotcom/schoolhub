const mongoose = require("mongoose");

const TeacherAccountSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true }, // email or username
    email: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true },
    role: { type: String, default: "teacher" },
    disabled: { type: Boolean, default: false }
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.TeacherAccount ||
  mongoose.model("TeacherAccount", TeacherAccountSchema);
