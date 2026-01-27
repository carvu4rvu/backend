exports.getStudentApplications = async (req, res) => {
  try {
    // const { usn } = req.params;
    // Query database for applications
    res.json([]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllDrives = async (req, res) => {
  try {
    res.json([]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllCompanies = async (req, res) => {
  try {
    res.json([]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};
