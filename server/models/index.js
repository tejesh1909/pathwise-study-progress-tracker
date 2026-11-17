const mongoose = require('mongoose');
const { Schema } = mongoose;

const User = mongoose.model(
  'User',
  new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 80 },
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      passwordHash: { type: String, required: true },
      role: { type: String, enum: ['learner', 'mentor'], default: 'learner', required: true },
      active: { type: Boolean, default: true },
    },
    { timestamps: true }
  )
);

const Goal = mongoose.model(
  'Goal',
  new Schema(
    {
      owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      title: { type: String, required: true, trim: true, maxlength: 80 },
      description: { type: String, default: '', maxlength: 500 },
      color: { type: String, default: 'violet' },
      targetDate: { type: String, default: '' }, // YYYY-MM-DD
      // set when a mentor assigned this goal: the mentor then manages its structure and may require approval
      assignedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      assignedByName: { type: String, default: '' },
      requireApproval: { type: Boolean, default: false },
    },
    { timestamps: true }
  )
);

const Topic = mongoose.model(
  'Topic',
  new Schema(
    {
      goal: { type: Schema.Types.ObjectId, ref: 'Goal', required: true, index: true },
      owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      title: { type: String, required: true, trim: true, maxlength: 80 },
      description: { type: String, default: '', maxlength: 500 },
      prerequisites: [{ type: Schema.Types.ObjectId, ref: 'Topic' }],
      complete: { type: Boolean, default: false },
      completedOn: { type: String, default: '' }, // YYYY-MM-DD
      estimateMinutes: { type: Number, default: 0 },
      notes: { type: String, default: '', maxlength: 2000 },
      resources: { type: [new Schema({ title: String, url: String }, { _id: false })], default: [] },
      // approval workflow: the learner submits, a mentor approves (complete) or sends it back (review)
      pending: { type: Boolean, default: false },
      pendingAt: { type: Date, default: null },
      review: {
        type: new Schema({ status: String, comment: String, by: Schema.Types.ObjectId, byName: String, at: Date }, { _id: false }),
        default: null,
      },
      order: { type: Number, default: 0 },
    },
    { timestamps: true }
  )
);

const Session = mongoose.model(
  'Session',
  new Schema(
    {
      owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      goal: { type: Schema.Types.ObjectId, ref: 'Goal', required: true, index: true },
      topic: { type: Schema.Types.ObjectId, ref: 'Topic', required: true, index: true },
      date: { type: String, required: true, index: true }, // YYYY-MM-DD
      minutes: { type: Number, required: true },
      time: { type: String, default: '' }, // optional HH:MM start time (feeds the smart planner)
      note: { type: String, default: '', maxlength: 500 },
    },
    { timestamps: true }
  )
);

// Single document holding the admin-configurable values used by the business rules.
const Setting = mongoose.model(
  'Setting',
  new Schema({ key: { type: String, unique: true, required: true }, values: { type: Schema.Types.Mixed, default: {} } }, { timestamps: true })
);

const Feedback = mongoose.model(
  'Feedback',
  new Schema(
    {
      goal: { type: Schema.Types.ObjectId, ref: 'Goal', required: true, index: true },
      author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      authorName: { type: String, required: true },
      text: { type: String, required: true, maxlength: 600 },
    },
    { timestamps: true }
  )
);

const Cohort = mongoose.model(
  'Cohort',
  new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 60, unique: true },
      description: { type: String, default: '', maxlength: 300 },
      members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    },
    { timestamps: true }
  )
);

// Read-only share links. Only a random token is stored in the URL; revoking deletes the document.
const Share = mongoose.model(
  'Share',
  new Schema(
    {
      token: { type: String, required: true, unique: true },
      goal: { type: Schema.Types.ObjectId, ref: 'Goal', required: true, index: true },
      owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      expiresAt: { type: Date, default: null },
    },
    { timestamps: true }
  )
);

const QuizAttempt = mongoose.model(
  'QuizAttempt',
  new Schema(
    {
      topic: { type: Schema.Types.ObjectId, ref: 'Topic', required: true, index: true },
      owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      score: { type: Number, required: true },
      total: { type: Number, required: true },
    },
    { timestamps: true }
  )
);

module.exports = { User, Goal, Topic, Session, Setting, Feedback, Cohort, Share, QuizAttempt };
