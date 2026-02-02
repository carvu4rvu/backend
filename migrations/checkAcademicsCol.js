const supabase = require('../config/supabaseClient');

const checkColumns = async () => {
    const table = 'student_semester_academics';
    console.log(`\nChecking table: ${table}`);
    
    // Check likely columns
    const likely = ['provisional_result_upload_links', 'result_upload_link', 'result_upload_links', 'marksheet_file'];
    
    for (const col of likely) {
        const { error: colError } = await supabase.from(table).select(col).limit(1);
        if (!colError) {
            console.log(`Confirmed column: ${col}`);
        } else {
             // console.log(`Column ${col} not found or error: ${colError.message}`);
        }
    }
};

checkColumns();
