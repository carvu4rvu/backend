const supabase = require('../config/supabaseClient');

/** Compute average rating: (self_rating + admin_rating) / 2; if admin_rating null, use self_rating only */
function averageRating(project) {
  const self = project.self_rating != null ? Number(project.self_rating) : 0;
  const admin = project.admin_rating != null ? Number(project.admin_rating) : null;
  if (admin != null) return (self + admin) / 2;
  return self;
}

/**
 * GET /api/placement/projects (admin)
 * List all student projects for admin: view, approve, rate.
 */
exports.getAllProjects = async (req, res) => {
  try {
    const { is_approved, visibility } = req.query;
    let query = supabase.from('student_projects').select('*').order('created_at', { ascending: false });

    if (is_approved !== undefined && is_approved !== '') {
      const val = is_approved === 'true';
      query = query.eq('is_approved', val);
    }
    if (visibility) query = query.eq('visibility', visibility);

    const { data, error } = await query;
    if (error) throw error;

    const withAverage = (data || []).map((p) => ({
      ...p,
      average_rating: averageRating(p),
    }));

    res.json(withAverage);
  } catch (error) {
    console.error('getAllProjects:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

/**
 * GET /api/placement/projects/public (no auth)
 * Public list for showcase: approved, PUBLIC only. Optional ?best=true for top-rated.
 */
exports.getPublicProjects = async (req, res) => {
  try {
    const { best, limit } = req.query;
    let query = supabase
      .from('student_projects')
      .select('*')
      .eq('visibility', 'PUBLIC')
      .eq('is_approved', true)
      .order('created_at', { ascending: false });

    const { data: rows, error } = await query;
    if (error) throw error;

    const withAverage = (rows || []).map((p) => ({
      ...p,
      average_rating: averageRating(p),
    }));

    // Sort by average_rating desc for "best"
    withAverage.sort((a, b) => (b.average_rating || 0) - (a.average_rating || 0));

    let result = withAverage;
    if (best === 'true') {
      result = withAverage.slice(0, Math.min(10, parseInt(limit, 10) || 10));
    } else if (limit) {
      result = withAverage.slice(0, Math.min(100, parseInt(limit, 10) || 50));
    }

    res.json(result);
  } catch (error) {
    console.error('getPublicProjects:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

/**
 * PATCH /api/placement/projects/:id (admin)
 * Update admin_rating and/or is_approved.
 */
exports.updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { admin_rating, is_approved } = req.body;

    const update = { updated_at: new Date() };
    if (typeof is_approved === 'boolean') update.is_approved = is_approved;
    if (admin_rating !== undefined && admin_rating !== null) {
      const r = Number(admin_rating);
      if (r < 1 || r > 10) return res.status(400).json({ message: 'admin_rating must be between 1 and 10' });
      update.admin_rating = r;
    }

    const { data, error } = await supabase
      .from('student_projects')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Project not found' });

    res.json({ ...data, average_rating: averageRating(data) });
  } catch (error) {
    console.error('updateProject:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};
