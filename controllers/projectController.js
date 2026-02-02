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

/**
 * GET /api/placement/projects/alumni (alumni)
 * Get approved public projects for alumni view with their like status
 */
exports.getAlumniProjects = async (req, res) => {
  try {
    const email = req.user?.email?.trim().toLowerCase();
    
    // Get alumni to check liked projects
    let likedProjectIds = [];
    if (email) {
      const { data: alumni } = await supabase
        .from('alumni')
        .select('liked_project_ids')
        .ilike('personal_email', email)
        .maybeSingle();
      
      likedProjectIds = alumni?.liked_project_ids || [];
    }

    // Get approved public projects
    const { data: projects, error } = await supabase
      .from('student_projects')
      .select('*')
      .eq('visibility', 'PUBLIC')
      .eq('is_approved', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Add average rating and like status
    const withExtras = (projects || []).map((p) => ({
      ...p,
      average_rating: averageRating(p),
      is_liked: likedProjectIds.includes(p.id),
    }));

    res.json(withExtras);
  } catch (error) {
    console.error('getAlumniProjects:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

/**
 * POST /api/placement/projects/:id/like (alumni)
 * Toggle like on a project
 */
exports.toggleProjectLike = async (req, res) => {
  try {
    const { id } = req.params;
    const projectId = parseInt(id, 10);
    const email = req.user?.email?.trim().toLowerCase();

    if (!email) {
      return res.status(403).json({ message: 'Not authenticated as alumni' });
    }

    // Get alumni
    const { data: alumni, error: alumniError } = await supabase
      .from('alumni')
      .select('id, liked_project_ids')
      .ilike('personal_email', email)
      .maybeSingle();

    if (alumniError) throw alumniError;
    if (!alumni) return res.status(404).json({ message: 'Alumni not found' });

    const likedIds = alumni.liked_project_ids || [];
    const isCurrentlyLiked = likedIds.includes(projectId);

    let newLikedIds;
    let likeDelta;

    if (isCurrentlyLiked) {
      // Unlike
      newLikedIds = likedIds.filter((lid) => lid !== projectId);
      likeDelta = -1;
    } else {
      // Like
      newLikedIds = [...likedIds, projectId];
      likeDelta = 1;
    }

    // Update alumni liked_project_ids
    const { error: updateAlumniError } = await supabase
      .from('alumni')
      .update({ liked_project_ids: newLikedIds, updated_at: new Date() })
      .eq('id', alumni.id);

    if (updateAlumniError) throw updateAlumniError;

    // Update project likes_count
    const { data: project, error: getProjectError } = await supabase
      .from('student_projects')
      .select('likes_count')
      .eq('id', projectId)
      .single();

    if (getProjectError) throw getProjectError;

    const newLikesCount = Math.max(0, (project?.likes_count || 0) + likeDelta);

    const { error: updateProjectError } = await supabase
      .from('student_projects')
      .update({ likes_count: newLikesCount })
      .eq('id', projectId);

    if (updateProjectError) throw updateProjectError;

    res.json({ 
      is_liked: !isCurrentlyLiked, 
      likes_count: newLikesCount 
    });
  } catch (error) {
    console.error('toggleProjectLike:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

/**
 * POST /api/placement/projects/:id/view (public or authenticated)
 * Increment view count
 */
exports.incrementProjectView = async (req, res) => {
  try {
    const { id } = req.params;
    const projectId = parseInt(id, 10);

    const { data: project, error: getError } = await supabase
      .from('student_projects')
      .select('views_count')
      .eq('id', projectId)
      .single();

    if (getError) throw getError;
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const newViewsCount = (project.views_count || 0) + 1;

    const { error: updateError } = await supabase
      .from('student_projects')
      .update({ views_count: newViewsCount })
      .eq('id', projectId);

    if (updateError) throw updateError;

    res.json({ views_count: newViewsCount });
  } catch (error) {
    console.error('incrementProjectView:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};
