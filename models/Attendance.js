const mongoose = require("mongoose");

const AttendanceRecordSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["PRESENT", "TARDY", "ABSENT"], default: "ABSENT" },
    time: { type: String, default: "" }, // e.g. "08:12"
  },
  { _id: false }
);

const AttendanceSchema = new mongoose.Schema(
  {
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "Class", required: true },
    dateKey: { type: String, required: true }, // "YYYY-MM-DD"
    records: { type: Map, of: AttendanceRecordSchema, default: {} }, // key = LRN
  },
  { timestamps: true }
);

// one doc per class per day
AttendanceSchema.index({ classId: 1, dateKey: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", AttendanceSchema);
