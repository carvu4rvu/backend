/**
 * Rules for which projects appear on the alumni / public showcase.
 * PUBLIC + approved = visible to alumni and anonymous viewers (non-owners).
 */

function normalizeVisibility(visibility) {
  return String(visibility || 'PRIVATE').toUpperCase().trim();
}

function normalizeProjectStatus(status) {
  return String(status || '').toLowerCase().trim();
}

function isPublicVisibility(visibility) {
  return normalizeVisibility(visibility) === 'PUBLIC';
}

function isApprovedStatus(status) {
  return normalizeProjectStatus(status) === 'approved';
}

/** Alumni showcase and public discovery */
function canShowOnAlumniShowcase(project) {
  if (!project) return false;
  return isApprovedStatus(project.project_status) && isPublicVisibility(project.visibility);
}

/** Admin / VC / placement staff — may like or view any project on internal showcase */
function isPrivilegedProjectRole(role) {
  const r = String(role || '').toLowerCase().trim();
  return r === 'admin' || r === 'vc' || r === 'placement';
}

/** Like, favorite, view: public rules OR privileged staff on manage/showcase */
function canEngageWithProject(project, role) {
  if (!project) return false;
  if (isPrivilegedProjectRole(role)) return true;
  return canShowOnAlumniShowcase(project);
}

/** SQL fragment for WHERE (use alias e.g. p) */
function alumniShowcaseWhere(alias = 'p') {
  return `LOWER(TRIM(${alias}.project_status::text)) = 'approved'
    AND UPPER(TRIM(COALESCE(${alias}.visibility::text, 'PRIVATE'))) = 'PUBLIC'`;
}

module.exports = {
  normalizeVisibility,
  normalizeProjectStatus,
  isPublicVisibility,
  isApprovedStatus,
  canShowOnAlumniShowcase,
  isPrivilegedProjectRole,
  canEngageWithProject,
  alumniShowcaseWhere,
};
