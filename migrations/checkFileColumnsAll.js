require('dotenv').config();
const supabase = require('../config/supabaseClient');

const tables = [
    { table: 'student_basic_details', column: 'profile_image' },
    { table: 'student_certifications', column: 'proof_document' },
    'student_internships',
    'student_trainings',
    'student_publications',
    'student_extra_curricular_activities',
    'student_other_experiences',
    'student_projects',
    'student_summer_immersion',
    'student_summer_internship',
    'student_education_history',
    'student_semester_academics'
];

async function checkColumns() {
    console.log('Checking columns for file uploads in tables...');
    
    for (const item of tables) {
        const tableName = typeof item === 'object' ? item.table : item;
        const targetCol = typeof item === 'object' ? item.column : null;

        try {
            const { data, error } = await supabase.from(tableName).select('*').limit(1);
            
            if (error) {
                console.error(`Error fetching ${tableName}:`, error.message);
                continue;
            }
            
            if (data && data.length > 0) {
                const keys = Object.keys(data[0]);
                const fileCols = keys.filter(k => k.includes('file') || k.includes('proof') || k.includes('document') || k.includes('image') || k.includes('snap') || k.includes('link'));
                console.log(`\nTable: ${tableName}`);
                console.log(`Found file/proof columns:`, fileCols);
                
                if (targetCol && !keys.includes(targetCol)) {
                    console.error(`MISSING TARGET COLUMN: ${targetCol} in ${tableName}`);
                } else if (targetCol) {
                    console.log(`Verified target column exists: ${targetCol}`);
                }
            } else {
                 console.log(`\nTable: ${tableName} is empty. Cannot verify columns via select *.`);
                 
                 const columnsToCheck = targetCol ? [targetCol] : ['proof_document', 'evidence_document', 'project_snaps', 'report_file', 'certificate_file', 'marksheet_file', 'provisional_result_upload_links'];
                 
                 for (const col of columnsToCheck) {
                     const { error: colError } = await supabase.from(tableName).select(col).limit(1);
                     if (!colError) {
                         console.log(`Table: ${tableName} HAS column: ${col}`);
                     } else {
                         // console.log(`Table: ${tableName} does NOT have column: ${col} (${colError.message})`);
                         if (targetCol) {
                             console.error(`Table: ${tableName} MISSING target column: ${col}`);
                         }
                     }
                 }
            }
            
        } catch (e) {
            console.error(`Exception checking ${tableName}:`, e);
        }
    }
}

checkColumns();
