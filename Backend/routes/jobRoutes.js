
import express from "express";
import {
  createJob,
  getAllJobs,
  getFeaturedJobs,
  getJobById,
  getJobsByEmployer,
  updateJob,
  deleteJob,
  getJobsByCompany,
  getApplicantsByJob,
  updateApplicationStatus,
  applyJob,
  getMyApplications,
  saveJob,
  getSavedJobs,
  removeSavedJob,
} from "../controllers/jobController.js";
import { approveOrRejectJob } from "../controllers/adminController.js";
import {
  verifyToken,
  isAdmin,
  isEmployer,
} from "../middlewares/authMiddleware.js";
import upload from "../utils/multer.js";

const router = express.Router();

router.post(
  "/create",
  (req, res, next) => {

  console.log("🎯 POST /job/create route hit");
  console.log("  - Has file:", !!req.file);

  if (req.body && typeof req.body === 'object') {
    console.log("  - Body keys:", Object.keys(req.body));
  } else {
    console.log("  - Body is null or not an object");
  }

  next();
  },
  verifyToken,
  isEmployer,
  upload.single("company_logo"),
  createJob
);

// Specific routes FIRST
router.get("/", getAllJobs);
router.get("/featured", getFeaturedJobs);
router.get("/my-jobs", verifyToken, isEmployer, getJobsByEmployer);
router.get("/my/applications", verifyToken, getMyApplications);
router.get("/saved", verifyToken, getSavedJobs);
router.get("/company/:employerId", getJobsByCompany);

// Note: Admin approval route moved to adminRoutes.js

// Save/Unsave job routes - BEFORE /:id routes
router.post("/:jobId/save", verifyToken, saveJob);
router.delete("/:jobId/save", verifyToken, removeSavedJob);

// Applicant management - MUST be before generic /:id routes
router.get("/:jobId/applicants", (req, res, next) => {
  console.log("🎯 Applicants route matched! JobId:", req.params.jobId);
  next();
}, verifyToken, isEmployer, getApplicantsByJob);
router.put("/:jobId/applicants/:applicationId/status", verifyToken, isEmployer, updateApplicationStatus);

// Job application - BEFORE /:id route
router.post("/:jobId/apply", verifyToken, upload.single("resume"), applyJob);

// Job CRUD - with parametric routes
router.put(
  "/:id",
  verifyToken,
  isEmployer,
  upload.single("company_logo"),
  updateJob
);

router.delete("/:id", verifyToken, isEmployer, deleteJob);

// Save a job
router.post("/save-job/:jobId", verifyToken, saveJob);

// Get all saved jobs of jobseeker
router.get("/save-job", verifyToken, getSavedJobs);

// Remove a saved job
router.delete("/save-job/:jobId", verifyToken, removeSavedJob);

// View all approved jobs by a company (Public)
router.get("/company/:employerId", getJobsByCompany);

// Apply for a job
router.post("/apply", verifyToken, upload.single("resume"), applyJob);

// Get all jobs posted by the logged-in jobseeker
router.get("/my-applications", verifyToken, getMyApplications);

// Note: applicants route is defined above as /:jobId/applicants

// Update application status (Approve/Reject) - Employer only
router.patch("/application/:application_id/status", verifyToken, updateApplicationStatus);

router.get("/", getAllJobs);
router.get("/:id", getJobById);

// Log all registered routes
console.log("📋 Job Routes registered:");
router.stack.forEach((r) => {
  if (r.route) {
    const methods = Object.keys(r.route.methods).join(', ').toUpperCase();
    console.log(`   ${methods} /job${r.route.path}`);
  }
});

export default router;