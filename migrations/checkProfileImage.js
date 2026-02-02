const supabase = require('../config/supabaseClient');

const checkAndFixProfileImageColumn = async () => {
    try {
        console.log("Checking student_basic_details table for profile_image column...");

        // Check if column exists
        const { data, error } = await supabase
            .from('student_basic_details')
            .select('profile_image')
            .limit(1);

        if (error) {
            if (error.code === 'PGRST204' || (error.message && error.message.includes('column'))) {
                console.log("Column profile_image missing. Attempting to add it...");
                
                // We cannot run DDL directly via Supabase JS client usually, unless we use a stored procedure or if the user has setup a raw SQL function.
                // But for this environment, we might have a 'rpc' function or we can just hope the user runs the SQL.
                // However, since I can't run SQL directly without an RPC, I will try to use the 'rpc' if available, 
                // or just log that it's missing.
                // Wait, I can try to use a raw query if I had a db client, but here I only have supabase client.
                
                console.error("CRITICAL: profile_image column is missing in student_basic_details.");
                console.error("Please run this SQL in your Supabase SQL Editor:");
                console.error("ALTER TABLE student_basic_details ADD COLUMN IF NOT EXISTS profile_image text;");
            } else {
                console.error("Error checking column:", error);
            }
        } else {
            console.log("Column profile_image exists.");
        }
    } catch (err) {
        console.error("Unexpected error:", err);
    }
};

checkAndFixProfileImageColumn();
