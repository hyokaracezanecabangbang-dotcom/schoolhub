const mongoose = require("mongoose");

const LessonSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },     // "Quiz 1"
    category: { type: String, required: true }, // "WW" | "PT" | "QE"
    max: { type: Number, required: true },      // 20, 50, 100
    dbKey: { type: String, required: true },    // "L1700000000000"
  },
  { _id: false }
);

const ClassSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    // ✅ class owner (YOU NEED THIS because your API filters by it)
    teacherUsername: { type: String, required: true, index: true },

    // ✅ can be object OR array (Mixed)
    weights: {
      type: mongoose.Schema.Types.Mixed,
      default: { ww: 40, pt: 30, qe: 30 }
    },

    lessons: { type: [LessonSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Class", ClassSchema);
