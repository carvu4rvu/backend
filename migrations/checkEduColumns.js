const supabase = require('../config/supabaseClient');

const checkColumns = async () => {
    const tables = [
        'student_education_history',
        'student_semester_academics'
    ];

    for (const table of tables) {
        console.log(`\nChecking table: ${table}`);
        const likelyColumns = ['proof_document', 'proof_file', 'result_upload_link', 'grade_card'];
        for (const col of likelyColumns) {
            const { error: colError } = await supabase.from(table).select(col).limit(1);
            if (!colError) {
                console.log(`Confirmed column exists: ${col}`);
            }
        }
    }
};

checkColumns();
