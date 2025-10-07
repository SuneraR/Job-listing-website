//Insert Employer Details
export const insertEmployerDetailsQuery = `
  INSERT INTO employer
    (user_id, company_name, company_address, company_website, contact_number, industry, description, profile_picture)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

//Get Employer Details
export const getEmployerDetailsQuery = `
  SELECT e.*, u.userName, u.email
  FROM employer e
  JOIN users u ON e.user_id = u.user_id
  WHERE e.user_id = ?
`;

//Update Employer Details
export const updateEmployerDetailsQuery = (fields) => `
  UPDATE employer SET ${fields.join(", ")} WHERE user_id = ?
`;

// Get current profile picture (before deleting)
export const getProfilePictureQuery = `
  SELECT profile_picture FROM employer WHERE user_id = ?
`;

// Remove profile picture only
export const deleteProfilePictureQuery = `
  UPDATE employer SET profile_picture = NULL WHERE user_id = ?
`;

//Insert JobSeeker Details
export const insertJobSeekerDetailsQuery = `
  INSERT INTO Job_Seeker
    (user_id, full_name, address, company_website, contact_number, birthday, gender, profile_picture)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

//Get JobSeeker Details
export const getJobSeekerDetailsQuery = `
  SELECT e.*, u.userName, u.email
  FROM Job_Seeker e
  JOIN users u ON e.user_id = u.user_id
  WHERE e.user_id = ?
`;

//Update JobSeeker Details
export const updateJobSeekerDetailsQuery = (fields) => `
  UPDATE Job_Seeker SET ${fields.join(", ")} WHERE user_id = ?
`;

// Get current profile picture (before deleting)
export const getJobSeekerProfilePictureQuery = `
  SELECT profile_picture FROM Job_Seeker WHERE user_id = ?
`;

// Remove profile picture only
export const deleteJobSeekerProfilePictureQuery = `
  UPDATE Job_Seeker SET profile_picture = NULL WHERE user_id = ?
`;

