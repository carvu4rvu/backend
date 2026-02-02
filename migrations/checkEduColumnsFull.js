const supabase = require('../config/supabaseClient');

const checkColumns = async () => {
    const tables = [
        'student_education_history',
        'student_semester_academics'
    ];

    for (const table of tables) {
        console.log(`\nChecking table: ${table}`);
        const { data, error } = await supabase.from(table).select('*').limit(1);
        if (data && data.length > 0) {
            console.log('Columns:', Object.keys(data[0]));
        } else {
             // If empty, try inserting a dummy to get error with column names if possible, or just list likely ones
             console.log("Table empty or no access. Cannot list all columns easily.");
        }
    }
};

checkColumns();
