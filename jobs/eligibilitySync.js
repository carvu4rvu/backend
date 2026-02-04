/**
 * Eligibility Sync Job
 * 
 * This job syncs eligibility flags from batch_academic_policies to student_basic_details.
 * 
 * IMPORTANT: This is a ONE-WAY sync (false → true ONLY)
 * - If a policy has eligibility = true, students will be updated to true
 * - If a policy has eligibility = false, students who already have true will NOT be changed
 * - This ensures manual eligibility grants are never revoked automatically
 * 
 * Runs every 10 minutes automatically, and can be triggered manually via API
 */

const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');

/**
 * Sync eligibility for all policies
 * @param {Object} options - Options
 * @param {boolean} options.dryRun - If true, don't actually update, just return what would be updated
 * @returns {Object} Summary of updates
 */
async function syncEligibility(options = {}) {
  const { dryRun = false } = options;
  const startTime = Date.now();
  const results = {
    policiesProcessed: 0,
    studentsUpdated: 0,
    updates: [],
    errors: [],
    dryRun
  };

  try {
    // Get all policies
    const { data: policies, error: policiesError } = await supabase
      .from('batch_academic_policies')
      .select('id, school_id, program_id, joining_year, summer_immersion, summer_internship, capstone, placement');

    if (policiesError) {
      throw new Error(`Failed to fetch policies: ${policiesError.message}`);
    }

    if (!policies || policies.length === 0) {
      logger.info('[EligibilitySync] No policies found');
      return results;
    }

    logger.info(`[EligibilitySync] Processing ${policies.length} policies...`);

    for (const policy of policies) {
      try {
        const policyUpdates = {
          policyId: policy.id,
          school_id: policy.school_id,
          program_id: policy.program_id,
          joining_year: policy.joining_year,
          fieldsUpdated: [],
          studentsAffected: 0
        };

        // Build update conditions - only update false → true
        const updateFields = [];
        
        if (policy.summer_immersion === true) {
          updateFields.push({
            field: 'is_summer_immersion_eligible',
            policyField: 'summer_immersion'
          });
        }
        if (policy.summer_internship === true) {
          updateFields.push({
            field: 'is_summer_internship_eligible',
            policyField: 'summer_internship'
          });
        }
        if (policy.capstone === true) {
          updateFields.push({
            field: 'is_capstone_eligible',
            policyField: 'capstone'
          });
        }
        if (policy.placement === true) {
          updateFields.push({
            field: 'is_placement_eligible',
            policyField: 'placement'
          });
        }

        // For each field that should be true, update students who have false
        for (const { field, policyField } of updateFields) {
          // Count students that need updating (currently false)
          const { count: needsUpdate, error: countError } = await supabase
            .from('student_basic_details')
            .select('usn', { count: 'exact', head: true })
            .eq('school_id', policy.school_id)
            .eq('program_id', policy.program_id)
            .eq('year_of_joining', policy.joining_year)
            .eq(field, false);

          if (countError) {
            logger.warn(`[EligibilitySync] Error counting students for ${field}:`, countError.message);
            continue;
          }

          if (needsUpdate > 0) {
            if (!dryRun) {
              // Update only students with false → true
              const { error: updateError, count: updated } = await supabase
                .from('student_basic_details')
                .update({ 
                  [field]: true,
                  updated_at: new Date().toISOString()
                }, { count: 'exact' })
                .eq('school_id', policy.school_id)
                .eq('program_id', policy.program_id)
                .eq('year_of_joining', policy.joining_year)
                .eq(field, false);

              if (updateError) {
                logger.warn(`[EligibilitySync] Error updating ${field}:`, updateError.message);
                results.errors.push({
                  policyId: policy.id,
                  field,
                  error: updateError.message
                });
              } else {
                policyUpdates.fieldsUpdated.push({ field: policyField, studentsUpdated: updated || needsUpdate });
                policyUpdates.studentsAffected += (updated || needsUpdate);
                results.studentsUpdated += (updated || needsUpdate);
              }
            } else {
              // Dry run - just record what would be updated
              policyUpdates.fieldsUpdated.push({ field: policyField, studentsToUpdate: needsUpdate });
              policyUpdates.studentsAffected += needsUpdate;
              results.studentsUpdated += needsUpdate;
            }
          }
        }

        if (policyUpdates.fieldsUpdated.length > 0) {
          results.updates.push(policyUpdates);
        }
        results.policiesProcessed++;

      } catch (policyError) {
        logger.error(`[EligibilitySync] Error processing policy ${policy.id}:`, policyError);
        results.errors.push({
          policyId: policy.id,
          error: policyError.message
        });
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`[EligibilitySync] Complete. Processed ${results.policiesProcessed} policies, updated ${results.studentsUpdated} students in ${duration}ms`);

    return results;

  } catch (error) {
    logger.error('[EligibilitySync] Job failed:', error);
    results.errors.push({ error: error.message });
    return results;
  }
}

/**
 * Sync eligibility for a specific policy (used when saving a single policy)
 */
async function syncPolicyEligibility(policyId) {
  try {
    const { data: policy, error } = await supabase
      .from('batch_academic_policies')
      .select('*')
      .eq('id', policyId)
      .single();

    if (error || !policy) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    // Only update false → true for enabled fields
    const updates = {};
    if (policy.summer_immersion) updates.is_summer_immersion_eligible = true;
    if (policy.summer_internship) updates.is_summer_internship_eligible = true;
    if (policy.capstone) updates.is_capstone_eligible = true;
    if (policy.placement) updates.is_placement_eligible = true;

    if (Object.keys(updates).length === 0) {
      return { studentsUpdated: 0, message: 'No eligibility flags enabled in policy' };
    }

    updates.updated_at = new Date().toISOString();

    // Build query to only update students where the field is currently false
    let totalUpdated = 0;
    for (const [field, value] of Object.entries(updates)) {
      if (field === 'updated_at') continue;
      
      const { count, error: updateError } = await supabase
        .from('student_basic_details')
        .update({ [field]: value, updated_at: updates.updated_at }, { count: 'exact' })
        .eq('school_id', policy.school_id)
        .eq('program_id', policy.program_id)
        .eq('year_of_joining', policy.joining_year)
        .eq(field, false);

      if (!updateError && count) {
        totalUpdated += count;
      }
    }

    return { studentsUpdated: totalUpdated };

  } catch (error) {
    logger.error(`[EligibilitySync] Error syncing policy ${policyId}:`, error);
    throw error;
  }
}

module.exports = {
  syncEligibility,
  syncPolicyEligibility
};
