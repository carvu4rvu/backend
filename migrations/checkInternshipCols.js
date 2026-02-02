const supabase = require('../config/supabaseClient');

const checkColumns = async () => {
    const table = 'student_internships';
    console.log(`\nChecking table: ${table}`);
    
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (data && data.length > 0) {
        console.log('Columns:', Object.keys(data[0]));
    } else {
        console.log("Table empty. Listing known columns by trying to select them.");
        const likely = ['job_role', 'jobRole', 'organization', 'organization_details', 'organizationDetails', 'duration_months', 'durationMonths', 'start_date', 'startDate', 'end_date', 'endDate', 'mentor_name', 'mentorName'];
        for (const col of likely) {
            const { error: colError } = await supabase.from(table).select(col).limit(1);
            if (!colError) console.log(`Confirmed column: ${col}`);
        }
    }
};

checkColumns();
