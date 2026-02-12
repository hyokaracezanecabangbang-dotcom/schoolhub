const mongoose = require("mongoose");

const StudentSchema = new mongoose.Schema(
  {
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "Class", required: true },
    name: { type: String, required: true },
    lrn: { type: String, required: true },

    // scores saved like: scores.L1700... = 18
    scores: { type: Map, of: Number, default: {} },

    finalGrade: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// ✅ allow same LRN in multiple classes, but not twice in the same class
StudentSchema.index({ classId: 1, lrn: 1 }, { unique: true });

module.exports = mongoose.model("Student", StudentSchema);
