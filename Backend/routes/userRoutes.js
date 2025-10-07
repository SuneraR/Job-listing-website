import express from 'express';
import { 
    createEmployerProfile,
    getEmployerDetails,
    updateEmployerDetails,
    deleteProfilePicture,
    createJobSeekerProfile,
    getJobSeekerDetails,
    updateJobSeekerDetails,
    deleteJobSeekerProfilePicture,
} from '../controllers/userController.js';
import upload from '../utils/multer.js';
import { verifyToken } from '../middlewares/authMiddleware.js';


const router = express.Router();

// Add employer details
router.post(
  "/employer/details",
  verifyToken,
  upload.single("profile_picture"), // <-- required if profile_picture file is sent
  createEmployerProfile
   
);

// Get employer details
router.get("/employer/details", verifyToken, getEmployerDetails);


// Update employer details
router.put("/employer/details", verifyToken, updateEmployerDetails);



// Upload profile picture
router.patch(
  "/employer/details",
  verifyToken,
  upload.single("profile_picture"),
  updateEmployerDetails
   
);

// Delete only profile picture
router.delete(
  "/employer/profile-picture",
  verifyToken,
  deleteProfilePicture
    
);
// Job Seeker routes
router.post(
  "/jobseeker/details", 
  verifyToken, 
  upload.single("profile_picture"), 
  createJobSeekerProfile
);

// get Job Seeker details
router.get("/jobseeker/details", verifyToken, getJobSeekerDetails);

// Update Job Seeker Profile
router.patch(
  "/jobseeker/details",
  verifyToken,
  upload.single("profile_picture"),
  // validateJobSeekerUpdate,
  updateJobSeekerDetails
);

// Delete only Profile Picture
router.delete(
  "/jobseeker/profile-picture", 
  verifyToken, 
  deleteJobSeekerProfilePicture
)

export default router;
