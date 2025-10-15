import pool from "../config/dbConnection.js";
import cloudinary from "../utils/cloudinary.js";
import { sendEmail } from "../utils/emailClient.js";
import {
  createJobRecord,
  findApprovedJobs,
  findApprovedJobById,
  findJobsByEmployerId,
  updateJobRecord,
  deleteJobRecord,
  findJobById,
  updateJobStatus,
  findApprovedJobsByCompany,
  incrementJobViews,
} from "../models/jobModel.js";

// Note: SQL queries are written inline in this controller for flexibility
import { updateApplicationStatusQuery } from "../queries/jobQueries.js";
import { getApplicationDetailsQuery } from "../queries/jobQueries.js";
import { checkExistingApplicationQuery } from "../queries/jobQueries.js";
import { findApprovedJobByIdQuery } from "../queries/jobQueries.js";
import { findSeekerByUserIdQuery } from "../queries/jobQueries.js";

import { findEmployerProfileByUserId } from "../models/employerModel.js";
import { findUserEmailById } from "../models/userModel.js";
import nodemailer from "nodemailer";

// Upload image buffer to Cloudinary
const uploadFromBuffer = (fileBuffer, folder) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        resolve(result);
      }
    );
    stream.end(fileBuffer);
  });

const STATUS_LABELS = {
  approved: "Approved",
  pending: "Pending review",
  rejected: "Rejected",
  closed: "Closed",
};

const toSafeNumber = (value) => {
  if (value === null || value === undefined) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normaliseJobForDashboard = (job = {}) => {
  if (!job) return null;

  const status = (job.status || "pending").toString().toLowerCase();
  const views = toSafeNumber(
    job.views ?? job.view_count ?? job.total_views ?? job.viewsCount
  );
  const applicants = toSafeNumber(
    job.applicants ??
      job.applicant_count ??
      job.applicants_count ??
      job.total_applicants ??
      job.applicationsCount
  );
  const conversionValue = views > 0 ? applicants / views : 0;
  const conversionRate =
    views > 0 ? `${Math.round(conversionValue * 100)}%` : "—";

  const tags = [job.work_type, job.job_type, job.experience_level, job.industry]
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter(Boolean);

  return {
    id: job.job_id ?? job.id ?? null,
    title: job.title ?? "Untitled role",
    location: job.location ?? "Location not specified",
    status,
    statusLabel: STATUS_LABELS[status] ?? STATUS_LABELS.pending,
    workType: job.work_type ?? null,
    jobType: job.job_type ?? null,
    experienceLevel: job.experience_level ?? null,
    industry: job.industry ?? null,
    salaryMin: job.salary_min ?? null,
    salaryMax: job.salary_max ?? null,
    companyLogo: job.company_logo ?? null,
    createdAt: job.created_at ?? job.createdAt ?? null,
    updatedAt: job.updated_at ?? job.updatedAt ?? null,
    views,
    applicants,
    conversionRate,
    conversionValue,
    tags,
    raw: job,
  };
};

const computeJobStats = (jobs = []) => {
  if (!jobs.length) {
    return {
      totalJobs: 0,
      totalViews: 0,
      totalApplicants: 0,
      averageViews: 0,
      topViewedJobId: null,
      topConversionJobId: null,
    };
  }

  let totalViews = 0;
  let totalApplicants = 0;
  let topViewedJob = null;
  let topConversionJob = null;

  jobs.forEach((job) => {
    totalViews += job.views;
    totalApplicants += job.applicants;

    if (!topViewedJob || job.views > topViewedJob.views) {
      topViewedJob = job;
    }

    if (
      !topConversionJob ||
      job.conversionValue > topConversionJob.conversionValue
    ) {
      topConversionJob = job;
    }
  });

  return {
    totalJobs: jobs.length,
    totalViews,
    totalApplicants,
    averageViews: jobs.length ? Math.round(totalViews / jobs.length) : 0,
    topViewedJobId: topViewedJob?.id ?? null,
    topConversionJobId: topConversionJob?.id ?? null,
  };
};

// Create a new job
export const createJob = async (req, res) => {
  try {
    console.log("🚀 createJob function called");
    console.log("  - User ID:", req.user?.id);
    console.log("  - Request body:", req.body);

    if (!req.body) {
      return res
        .status(400)
        .json({ error: "Request body is required to create a job" });
    }

    const userId = req.user.id;
    console.log("🔍 Looking up employer profile for user:", userId);

    const profile = await findEmployerProfileByUserId(userId);
    console.log(
      "📋 Employer profile found:",
      profile.length > 0 ? "Yes" : "No"
    );

    if (profile.length === 0) {
      return res
        .status(400)
        .json({ error: "Please complete your employer profile first." });
    }

    // IMPORTANT: Database constraint requires employer_id to reference users.user_id
    // So we use userId instead of company_id
    const employerId = userId; // Use user_id because of FK constraint
    console.log(
      "📝 Creating job - User ID:",
      userId,
      "| Employer ID:",
      employerId
    );
    console.log("📝 Employer profile data:", profile[0]);

    const {
      title,
      description,
      location,
      work_type,
      job_type,
      experience_level,
      industry,
      salary_min,
      salary_max,
    } = req.body;

    if (!title || !description || !location || !industry) {
      return res.status(400).json({ error: "Required fields missing" });
    }

    if (salary_min === undefined || salary_max === undefined) {
      return res
        .status(400)
        .json({ error: "Salary range (salary_min, salary_max) is required" });
    }

    let logoUrl = null;
    if (req.file) {
      const uploadResult = await uploadFromBuffer(
        req.file.buffer,
        "company/logos"
      );
      logoUrl = uploadResult.secure_url;
    }

    const insertResult = await createJobRecord([
      employerId, // Use user_id because FK constraint points to users.user_id
      title.trim(),
      description,
      location,
      (work_type || "onsite").toLowerCase(),
      (job_type || "full-time").toLowerCase(),
      (experience_level || "entry").toLowerCase(),
      industry,
      salary_min,
      salary_max,
      logoUrl,
    ]);

    let jobPayload = null;

    if (insertResult?.insertId) {
      const createdJobs = await findJobById(insertResult.insertId);
      if (createdJobs.length > 0) {
        jobPayload = normaliseJobForDashboard(createdJobs[0]);
      }
    }

    res.status(201).json({
      message: "Job created successfully and waiting for admin approval.",
      job: jobPayload,
    });
  } catch (err) {
    console.error("❌ Create job error:", err);
    console.error("❌ Error stack:", err.stack);
    console.error("❌ Error details:", {
      message: err.message,
      code: err.code,
      sqlMessage: err.sqlMessage,
      sql: err.sql,
      errno: err.errno,
    });
    res.status(500).json({
      error: "Server error while creating job",
      message: err.message,
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Get all approved jobs
export const getAllJobs = async (req, res) => {
  try {
    const jobs = await findApprovedJobs();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: "Server error while fetching jobs" });
  }
};

// Get featured jobs (latest 6 approved jobs)
export const getFeaturedJobs = async (req, res) => {
  try {
    const [jobs] = await pool.query(
      `SELECT 
        j.job_id,
        j.title,
        j.description,
        j.location,
        j.salary_min,
        j.salary_max,
        j.job_type,
        j.work_type,
        j.company_logo,
        j.created_at,
        e.company_name
       FROM jobs j
       LEFT JOIN employers e ON j.employer_id = e.user_id
       WHERE j.status = 'approved'
       ORDER BY j.created_at DESC
       LIMIT 6`
    );
    res.json(jobs);
  } catch (err) {
    console.error("❌ Error fetching featured jobs:", err);
    res.status(500).json({ error: "Server error while fetching featured jobs" });
  }
};

// get job by id
export const getJobById = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("👁️ Getting job by ID:", id);

    const job = await findApprovedJobById(id);

    if (job.length === 0) {
      console.log("❌ Job not found:", id);
      return res.status(404).json({ error: "Job not found" });
    }
    let jobRecord = job[0];
    console.log(
      "✅ Job found:",
      jobRecord.title,
      "| Current views:",
      jobRecord.views
    );

    try {
      console.log("📈 Incrementing views for job:", id);
      await incrementJobViews(id);
      const previousViews = Number(
        jobRecord.views ?? jobRecord.view_count ?? jobRecord.total_views ?? 0
      );
      const updatedViews = Number.isFinite(previousViews)
        ? previousViews + 1
        : 1;
      jobRecord = {
        ...jobRecord,
        views: updatedViews,
      };
      console.log("✅ Views incremented to:", updatedViews);
    } catch (viewError) {
      console.error("❌ Failed to increment job views:", viewError);
    }

    res.json(jobRecord);
  } catch (err) {
    console.error("❌ Error in getJobById:", err);
    res.status(500).json({ error: "Server error while fetching job" });
  }
};

// get jobs by employer
export const getJobsByEmployer = async (req, res) => {
  try {
    const userId = req.user.id;
    console.log("📋 Fetching jobs for user:", userId);

    // Database uses user_id as employer_id (FK constraint to users.user_id)
    const jobRows = await findJobsByEmployerId(userId);
    console.log(`✅ Found ${jobRows.length} jobs for user ${userId}`);

    // Fetch application counts for each job
    const jobIds = jobRows.map((job) => job.job_id);
    let applicationCounts = {};

    if (jobIds.length > 0) {
      const [counts] = await pool.query(
        `SELECT job_id, COUNT(*) as count 
         FROM job_applications 
         WHERE job_id IN (?)
         GROUP BY job_id`,
        [jobIds]
      );

      counts.forEach((row) => {
        applicationCounts[row.job_id] = row.count;
      });

      console.log("📊 Application counts:", applicationCounts);
    }

    // Add applicant counts to job data
    const jobsWithCounts = jobRows.map((job) => ({
      ...job,
      applicants: applicationCounts[job.job_id] || 0,
    }));

    const jobs = jobsWithCounts
      .map((job) => normaliseJobForDashboard(job))
      .filter(Boolean);

    if (jobs.length > 0) {
      console.log("📊 First job with count:", {
        id: jobs[0].id,
        title: jobs[0].title,
        applicants: jobs[0].applicants,
      });
    }

    const stats = computeJobStats(jobs);

    res.json({ jobs, stats });
  } catch (err) {
    console.error("❌ Error fetching jobs:", err);
    res.status(500).json({ error: "Server error while fetching jobs" });
  }
};

// update job
export const updateJob = async (req, res) => {
  try {
    const { id } = req.params;
    const employerId = req.user.id; // Use user_id as employer_id

    const fields = [];
    const values = [];

    if (req.file) {
      const uploadResult = await uploadFromBuffer(
        req.file.buffer,
        "company/logos"
      );
      fields.push("company_logo=?");
      values.push(uploadResult.secure_url);
    }

    const editableFields = [
      "title",
      "description",
      "location",
      "work_type",
      "job_type",
      "experience_level",
      "industry",
      "salary_min",
      "salary_max",
    ];

    editableFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        fields.push(`${field}=?`);
        values.push(req.body[field]);
      }
    });

    if (fields.length === 0) {
      return res.status(400).json({ error: "No fields provided to update" });
    }

    const result = await updateJobRecord(fields, values, id, employerId);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Job not found or not authorized" });
    }

    let updatedJob = null;
    const jobs = await findJobById(id);
    if (jobs.length > 0) {
      updatedJob = normaliseJobForDashboard(jobs[0]);
    }

    res.status(200).json({
      message: "Job updated successfully and waiting for admin approval.",
      job: updatedJob,
    });
  } catch (err) {
    console.error("Update job error:", err);
    res.status(500).json({ error: "Server error while updating job" });
  }
};

// Delete job
export const deleteJob = async (req, res) => {
  try {
    const employerId = req.user.id; // Use user_id as employer_id
    const { id } = req.params;

    const result = await deleteJobRecord(id, employerId);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Job not found or not authorized" });
    }

    const jobRows = await findJobsByEmployerId(employerId);
    const jobs = jobRows
      .map((job) => normaliseJobForDashboard(job))
      .filter(Boolean);
    const stats = computeJobStats(jobs);

    res.json({ message: "Job deleted successfully", jobs, stats });
  } catch (err) {
    res.status(500).json({ error: "Server error while deleting job" });
  }
};

// Email transporter (Gmail setup)
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Use App Password
  },
});

// Approve or Reject Job (Admin only)
export const approveOrRejectJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { status, reason } = req.body; // status = 'approved' | 'rejected'

    // Validate input
    if (!["approved", "rejected"].includes(status)) {
      return res
        .status(400)
        .json({ error: "Invalid status. Use 'approved' or 'rejected'." });
    }

    // Fetch job and employer info
    const [jobResult] = await pool.query(
      `SELECT j.title, u.email 
       FROM jobs j 
       JOIN users u ON j.employer_id = u.user_id 
       WHERE j.job_id = ?`,
      [jobId]
    );

    if (jobResult.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    const { title, email } = jobResult[0];

    // Update job status and optional rejection reason
    await pool.query(
      "UPDATE jobs SET status = ?, rejection_reason = ? WHERE job_id = ?",
      [status, status === "rejected" ? reason || "Not specified" : null, jobId]
    );

    // Send appropriate email
    const mailOptions =
      status === "approved"
        ? {
            from: process.env.SMTP_USER,
            to: email,
            subject: `Job Approved ✅ - ${title}`,
            html: `
              <p>Hello,</p>
              <p>Your job posting <b>${title}</b> has been <b>approved</b> by the admin and is now visible to job seekers.</p>
            `,
          }
        : {
            from: process.env.SMTP_USER,
            to: email,
            subject: `Job Rejected ❌ - ${title}`,
            html: `
              <p>Hello,</p>
              <p>Unfortunately, your job posting <b>${title}</b> has been <b>rejected</b> by the admin.</p>
              <p><b>Reason:</b> ${reason || "Not specified"}</p>
            `,
          };

    await transporter.sendMail(mailOptions);

    // Send response
    res.json({
      message:
        status === "approved"
          ? "Job approved successfully ✅ Email sent to employer."
          : "Job rejected ❌ Email sent with reason to employer.",
    });
  } catch (err) {
    console.error("Approve/Reject job error:", err);
    res
      .status(500)
      .json({ error: "Server error while approving/rejecting job." });
  }
};

export const getEmployerJobs = async (req, res) => {
  try {
    const jobs = await findJobById(jobId);

    if (jobs.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    await updateJobStatus(status, jobId);

    const employer = await findUserEmailById(jobs[0].employer_id);

    if (employer.length > 0) {
      await sendEmail({
        to: employer[0].email,
        subject: `Your job "${jobs[0].title}" has been ${status}`,
        text: `Hello, your job posting "${jobs[0].title}" has been ${status} by the admin.`,
      });
    }

    res.status(200).json({
      message: `Job ${status} successfully${
        employer.length > 0 ? " and email sent to employer" : ""
      }.`,
    });
  } catch (err) {
    console.error("Approve job error:", err);
    res.status(500).json({ error: "Server error while approving job" });
  }
};

// Save a job
export const saveJob = async (req, res) => {
  try {
    const userId = req.user.id; // This is user_id from token
    const { jobId } = req.params;

    console.log("🔖 Saving job:", jobId, "for user:", userId);

    const job = await findApprovedJobById(jobId);
    if (job.length === 0) {
      return res
        .status(404)
        .json({ error: "Job not found or not approved yet" });
    }

    // Check if already saved (jobseeker_id in saved_jobs table references users.user_id)
    const [existing] = await pool.query(
      "SELECT * FROM saved_jobs WHERE jobseeker_id = ? AND job_id = ?",
      [userId, jobId]
    );
    
    if (existing.length > 0) {
      return res.status(409).json({ error: "Job already saved" });
    }

    // Save the job (jobseeker_id is actually user_id based on FK constraint)
    await pool.query(
      "INSERT INTO saved_jobs (jobseeker_id, job_id) VALUES (?, ?)",
      [userId, jobId]
    );

    console.log("✅ Job saved successfully");
    res.status(201).json({ message: "Job saved successfully" });
  } catch (err) {
    console.error("Save job error:", err);
    res.status(500).json({ error: "Server error while saving job" });
  }
};

// Get saved jobs for a jobseeker
export const getSavedJobs = async (req, res) => {
  try {
    const userId = req.user.id; // This is user_id from token

    console.log("📚 Fetching saved jobs for user:", userId);

    // First, check if saved_jobs table exists and get its structure
    try {
      const [testRows] = await pool.query(
        "SELECT * FROM saved_jobs WHERE jobseeker_id = ? LIMIT 1",
        [userId]
      );
      console.log("✅ saved_jobs table accessible, sample row:", testRows[0]);
    } catch (testErr) {
      console.error("❌ Error accessing saved_jobs table:", testErr.message);
      console.error("SQL Error Code:", testErr.code);
      console.error("SQL State:", testErr.sqlState);
      return res.status(500).json({ 
        error: "Database table error", 
        details: testErr.message 
      });
    }

    // Get saved jobs with job details (jobseeker_id in saved_jobs references users.user_id)
    const [rows] = await pool.query(
      `SELECT 
        j.job_id as id,
        j.title,
        j.description,
        j.location,
        j.salary_min,
        j.salary_max,
        j.job_type,
        j.company_logo,
        j.created_at as posted_at,
        e.company_name
      FROM saved_jobs sj
      JOIN jobs j ON sj.job_id = j.job_id
      LEFT JOIN employers e ON j.employer_id = e.user_id
      WHERE sj.jobseeker_id = ?
      ORDER BY j.created_at DESC`,
      [userId]
    );

    console.log("✅ Found", rows.length, "saved jobs");
    res.json({ jobs: rows });
  } catch (err) {
    console.error("Get saved jobs error:", err);
    console.error("Error details:", {
      message: err.message,
      code: err.code,
      sqlState: err.sqlState,
      sql: err.sql
    });
    res.status(500).json({ 
      error: "Server error while fetching saved jobs",
      details: err.message 
    });
  }
};

// Remove a saved job
export const removeSavedJob = async (req, res) => {
  try {
    const userId = req.user.id; // This is user_id from token
    const { jobId } = req.params;

    console.log("🗑️ Removing saved job:", jobId, "for user:", userId);

    // Remove the saved job (jobseeker_id in saved_jobs references users.user_id)
    const [result] = await pool.query(
      "DELETE FROM saved_jobs WHERE jobseeker_id = ? AND job_id = ?",
      [userId, jobId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Saved job not found" });
    }

    console.log("✅ Saved job removed successfully");
    res.json({ message: "Saved job removed successfully" });
  } catch (err) {
    console.error("Remove saved job error:", err);
    res.status(500).json({ error: "Server error while removing saved job" });
  }
};

// Get Jobs by specific Company (approved jobs only)
export const getJobsByCompany = async (req, res) => {
  try {
    const { employerId } = req.params;
    const jobs = await findApprovedJobsByCompany(employerId);

    if (jobs.length === 0) {
      return res
        .status(404)
        .json({ message: "No approved jobs found for this company." });
    }

    res.status(200).json(jobs);
  } catch (err) {
    console.error("Error fetching company jobs:", err);
    res
      .status(500)
      .json({ error: "Server error while fetching company jobs." });
  }
};

// Apply for a job (Jobseeker)
export const applyJob = async (req, res) => {
  try {
    const userId = req.user.id;
    // Get job_id from URL parameter first, fallback to body
    const jobIdFromParams = req.params.jobId;
    const jobIdFromBody = req.body.job_id;
    const job_id = jobIdFromParams || jobIdFromBody;

    console.log("Apply Job Debug:");
    console.log("- jobId from params:", jobIdFromParams);
    console.log("- jobId from body:", jobIdFromBody);
    console.log("- final job_id:", job_id);
    console.log("- userId:", userId);

    if (!job_id) {
      return res.status(400).json({ error: "Job ID is required" });
    }

    const { cover_letter } = req.body;

    // Check if jobseeker profile exists
    const [seekerRows] = await pool.query(
      findSeekerByUserIdQuery,
      [userId]
    );
    if (seekerRows.length === 0) {
      return res.status(403).json({
        error: "Please create your job seeker profile first.",
        action: "/jobseeker/profile/create",
      });
    }

    const seekerId = seekerRows[0].seeker_id;

    // Check if job exists and is approved
    const [allJobs] = await pool.query(
      findApprovedJobByIdQuery,
      [job_id]
    );

    if (allJobs.length === 0) {
      console.log("Job not found in database, job_id:", job_id);
      return res.status(404).json({
        error:
          "Job not found. The job may have been removed or is no longer available.",
      });
    }

    const jobData = allJobs[0];
    console.log("Job found:", jobData.job_title, "Status:", jobData.status);

    // Check if job is approved
    if (jobData.status !== "approved") {
      console.log("Job not approved yet. Current status:", jobData.status);
      return res.status(400).json({
        error:
          "This job is not currently accepting applications. It may be pending admin approval.",
        jobStatus: jobData.status,
      });
    }

    // Get full job details for approved job
    const [jobRows] = await pool.query("SELECT * FROM jobs WHERE job_id = ?", [
      job_id,
    ]);

    // Prevent duplicate applications
    const [existing] = await pool.query(
      checkExistingApplicationQuery,
      [job_id, seekerId]
    );
    if (existing.length > 0) {
      return res
        .status(400)
        .json({ error: "You have already applied for this job" });
    }

    // Handle uploaded resume (PDF)
    let uploadedResume = null;
    if (req.file) {
      const result = await cloudinary.uploader.upload(
        `data:${req.file.mimetype};base64,${req.file.buffer.toString(
          "base64"
        )}`,
        { folder: "resumes", resource_type: "raw" }
      );
      uploadedResume = result.secure_url;
    }

    const resumePath = uploadedResume || req.body.resume_url || null;

    // Insert application into DB
    await pool.query(
      "INSERT INTO job_applications (job_id, seeker_id, cover_letter, resume_url, status) VALUES (?, ?, ?, ?, 'Pending')",
      [job_id, seekerId, cover_letter, resumePath]
    );

    // Generate download-ready URL for PDF with proper filename and extension
    const getDownloadUrl = (url, filename = "resume.pdf") => {
      if (!url) return null;
      const parts = url.split("/upload/");
      if (parts.length !== 2) return url;
      
      // Get the file path after upload/
      const filePath = parts[1];
      
      // Remove any existing extension and add .pdf
      const pathWithoutExt = filePath.replace(/\.[^/.]+$/, '');
      
      // Use Cloudinary's fl_attachment transformation with proper filename
      const encodedFilename = encodeURIComponent(filename);
      return `${parts[0]}/upload/fl_attachment:${encodedFilename}/${pathWithoutExt}.pdf`;
    };

    const downloadUrl = getDownloadUrl(resumePath);

    // Respond to client
    res.status(201).json({
      message: "Job application submitted successfully",
      resume: resumePath,
      downloadUrl,
    });
  } catch (err) {
    console.error("applyJob Error:", err);
    res.status(500).json({
      error: "Server error while applying for job",
      details: err.message,
    });
  }
};

// Get all applications of current jobseeker
export const getMyApplications = async (req, res) => {
  try {
    const userId = req.user.id;

    console.log("📋 Fetching applications for user:", userId);

    // Get seeker_id from user_id
    const [seekerRows] = await pool.query(
      "SELECT seeker_id FROM job_seeker WHERE user_id = ?",
      [userId]
    );
    
    if (seekerRows.length === 0) {
      console.log("❌ Jobseeker profile not found for user:", userId);
      return res.status(404).json({ error: "Jobseeker profile not found" });
    }

    const jobseekerId = seekerRows[0].seeker_id;
    console.log("✅ Found seeker_id:", jobseekerId);

    // Fetch applications with job details
    const [applications] = await pool.query(
      `SELECT 
        a.application_id,
        a.job_id,
        a.seeker_id,
        a.cover_letter,
        a.resume_url,
        a.status,
        a.applied_at,
        j.title,
        j.company_logo,
        j.location,
        j.job_type,
        j.work_type,
        e.company_name
       FROM job_applications a
       JOIN jobs j ON a.job_id = j.job_id
       LEFT JOIN employers e ON j.employer_id = e.user_id
       WHERE a.seeker_id = ?
       ORDER BY a.applied_at DESC`,
      [jobseekerId]
    );

    console.log("✅ Found", applications.length, "applications");
    res.json({ applications });
  } catch (err) {
    console.error("getMyApplications Error:", err);
    res.status(500).json({ error: "Server error while fetching applications" });
  }
};

// Get all applicants for a specific job (Employer only)
export const getApplicantsByJob = async (req, res) => {
  try {
    const employerId = req.user.id; // This is user_id, which is employer_id in jobs table
    const jobId = req.params.jobId;

    console.log(
      "🔍 Fetching applicants - Employer ID:",
      employerId,
      "| Job ID:",
      jobId
    );

    // Verify job ownership (employer_id in jobs references user_id in users)
    const [jobOwnership] = await pool.query(
      "SELECT job_id FROM jobs WHERE job_id = ? AND employer_id = ?",
      [jobId, employerId]
    );

    if (jobOwnership.length === 0) {
      // Check if job exists at all
      const [jobExists] = await pool.query(
        "SELECT job_id, employer_id FROM jobs WHERE job_id = ?",
        [jobId]
      );

      if (jobExists.length === 0) {
        console.log("❌ Job not found - Job ID:", jobId);
        return res.status(404).json({ error: "Job not found" });
      } else {
        console.log(
          "❌ Not authorized - Job belongs to user:",
          jobExists[0].employer_id,
          "| Your user ID:",
          employerId
        );
        return res.status(403).json({
          error: "Not authorized for this job",
          message: "This job belongs to a different employer",
        });
      }
    }

    // Fetch applicants with job seeker details
    const [applicants] = await pool.query(
      `SELECT a.application_id, a.status, a.applied_at,
              js.full_name AS jobseeker_name,
              u.email AS jobseeker_email,
              a.cover_letter, a.resume_url
         FROM job_applications a
         JOIN job_seeker js ON a.seeker_id = js.seeker_id
         JOIN users u ON js.user_id = u.user_id
        WHERE a.job_id = ?`,
      [jobId]
    );

    console.log(`✅ Found ${applicants.length} applicants for job ${jobId}`);

    // Add download filename to each applicant
    const applicantsWithDownload = applicants.map((app) => {
      // Create safe filename from applicant name
      const safeName = app.jobseeker_name
        ? app.jobseeker_name.replace(/[^a-zA-Z0-9]/g, '_')
        : 'resume';
      const filename = `${safeName}_resume.pdf`;
      
      return {
        ...app,
        downloadFilename: filename,
      };
    });

    res.json(applicantsWithDownload);
  } catch (err) {
    console.error("getApplicantsByJob Error:", err);
    console.error("Error details:", err.message);
    res.status(500).json({ error: "Server error while fetching applicants" });
  }
};

// Update application status + send email (Employer only)
export const updateApplicationStatus = async (req, res) => {
  try {
    const employerId = req.user.id;
    const applicationId = req.params.applicationId; // Route uses :applicationId
    const { status } = req.body;

    console.log("🔄 Updating application status:", applicationId, "to", status);

    // Allow all status values from frontend (case-insensitive)
    const validStatuses = [
      "Pending",
      "Reviewed",
      "Shortlisted",
      "Interviewed",
      "Rejected",
      "Approved",
    ];
    if (!validStatuses.includes(status))
      return res.status(400).json({ error: "Invalid status" });

    // Fetch application + job + jobseeker info
    const [rows] = await pool.query(
      getApplicationDetailsQuery,
      [applicationId]
    );

    if (rows.length === 0) {
      console.log("❌ Application not found");
      return res.status(404).json({ error: "Application not found" });
    }

    const app = rows[0];

    // Verify employer owns the job
    if (app.employer_id !== employerId) {
      console.log("❌ Not authorized - wrong employer");
      return res
        .status(403)
        .json({ error: "Not authorized to modify this application" });
    }

    // Update status
    await pool.query(
      updateApplicationStatusQuery,
      [status, applicationId]
    );

    console.log("✅ Status updated successfully");

    // Send email notification only for Approved/Rejected
    if (status === "Approved" || status === "Rejected") {
      try {
        const transporter = nodemailer.createTransport({
          service: process.env.SMTP_SERVICE || "gmail",
          auth: {
            user: process.env.SMTP_USER || process.env.EMAIL_USER,
            pass: process.env.SMTP_PASS || process.env.EMAIL_PASS,
          },
        });

        const subject =
          status === "Approved"
            ? "🎉 Your job application was approved!"
            : "❌ Your job application was rejected";

        const text =
          status === "Approved"
            ? `Hello ${app.jobseeker_name},

Congratulations! Your application for the job "${app.job_title}" has been approved by the employer.`
            : `Hello ${app.jobseeker_name},

We regret to inform you that your application for the job "${app.job_title}" has been rejected.`;

        await transporter.sendMail({
          from: `"Job Portal" <${process.env.SMTP_USER || process.env.EMAIL_USER}>`,
          to: app.email,
          subject,
          text,
        });

        console.log("📧 Email notification sent");
      } catch (emailErr) {
        console.error("⚠️ Email sending failed:", emailErr.message);
        // Don't fail the whole request if email fails
      }
    }

    res.json({
      message: `Application ${status.toLowerCase()} successfully and email sent.`,
    });
  } catch (err) {
    console.error("updateApplicationStatus Error:", err);
    res.status(500).json({ error: "Server error while updating status" });
  }
};
