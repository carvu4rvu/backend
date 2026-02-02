const supabase = require('../config/supabaseClient');

const checkColumns = async () => {
    const tables = [
        'student_internships',
        'student_trainings',
        'student_certifications',
        'student_publications',
        'student_extra_curricular_activities',
        'student_other_experiences',
        'student_summer_internship',
        'student_summer_immersion'
    ];

    for (const table of tables) {
        console.log(`\nChecking table: ${table}`);
        const { data, error } = await supabase
            .from(table)
            .select('*')
            .limit(1);
        
        if (error) {
            console.error(`Error checking ${table}:`, error.message);
            // If table is empty, we can't see columns from data, but error usually indicates if table exists
        } else {
            if (data && data.length > 0) {
                console.log('Columns:', Object.keys(data[0]));
            } else {
                console.log('Table is empty. Attempting to insert dummy to find schema or using error to detect columns is harder with just JS client.');
                console.log('We will rely on existing knowledge or assume standard snake_case.');
                // Try to select specific likely columns to see if they error
                const likelyColumns = ['proof_document', 'proof_file', 'evidence_document', 'certificate_file', 'document_url'];
                for (const col of likelyColumns) {
                    const { error: colError } = await supabase.from(table).select(col).limit(1);
                    if (!colError) {
                        console.log(`Confirmed column exists: ${col}`);
                    }
                }
            }
        }
    }
};

checkColumns();
