const supabase = require('../config/supabaseClient');

const checkColumns = async () => {
    const tables = [
        'student_projects'
    ];

    for (const table of tables) {
        console.log(`\nChecking table: ${table}`);
        const { data, error } = await supabase.from(table).select('*').limit(1);
        if (data && data.length > 0) {
            console.log('Columns:', Object.keys(data[0]));
        } else {
             console.log("Table empty.");
             const likely = ['project_snaps', 'proof_document', 'images'];
             for (const col of likely) {
                 const { error: colError } = await supabase.from(table).select(col).limit(1);
                 if (!colError) console.log(`Confirmed column: ${col}`);
             }
        }
    }
};

checkColumns();
